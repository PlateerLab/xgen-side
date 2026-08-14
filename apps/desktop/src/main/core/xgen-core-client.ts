import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface, type Interface } from 'node:readline';
import type { CoreBlobStore, CoreLocalDataKey } from '../storage/core-blob-store';
import {
  currentDesktopArchitecture,
  currentDesktopPlatform,
  xgenDaemonBinaryName,
} from '../platform/platform-runtime';

const PROTOCOL = 'xgen.core.v1';
const RESPONSE_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_CHARACTERS = 16 * 1024 * 1024;

export interface XgenCoreStatus {
  available: boolean;
  service?: string;
  protocolVersion?: number;
  platform?: string;
  architecture?: string;
  executablePath?: string;
  capabilities?: string[];
  error?: string;
}

export interface XgenBrowserRelayRequest {
  runId: string;
  enginePath: string;
  toolProfiles: string[];
  environment: Record<string, string>;
}

export interface XgenBrowserRelayConnection {
  address: string;
  token: string;
  protocol: 'xgen.mcp-relay.v1';
}

interface CoreResponse {
  protocol: string;
  id: string;
  ok: boolean;
  result?: Record<string, unknown>;
  error?: { code?: string; message?: string };
}

interface PendingRequest {
  resolve(value: Record<string, unknown>): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

export class XgenCoreClient implements CoreBlobStore {
  private child: ChildProcessWithoutNullStreams | undefined;
  private reader: Interface | undefined;
  private sessionToken: string | undefined;
  private executablePath: string | undefined;
  private statusValue: XgenCoreStatus = { available: false, error: 'XGEN Core has not started.' };
  private pending = new Map<string, PendingRequest>();
  private exitPromise: Promise<void> | undefined;
  private resolveExit: (() => void) | undefined;
  private startPromise: Promise<XgenCoreStatus> | undefined;
  private stopping = false;

  constructor(
    private readonly appPath: string,
    private readonly resourcesPath: string,
    private readonly dataRoot: string,
  ) {}

  start(): Promise<XgenCoreStatus> {
    if (this.child && this.statusValue.available) return Promise.resolve(this.status());
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startInternal().finally(() => { this.startPromise = undefined; });
    return this.startPromise;
  }

  status(): XgenCoreStatus {
    return { ...this.statusValue, capabilities: this.statusValue.capabilities?.slice() };
  }

  isRunning(): boolean {
    return Boolean(this.child && !this.child.killed);
  }

  async startBrowserRelay(request: XgenBrowserRelayRequest): Promise<XgenBrowserRelayConnection> {
    const result = await this.request('browser.start', { ...request });
    if (result.state !== 'ready'
      || typeof result.address !== 'string'
      || typeof result.token !== 'string'
      || result.protocol !== 'xgen.mcp-relay.v1') {
      throw new Error('XGEN Core returned an invalid browser relay.');
    }
    return {
      address: result.address,
      token: result.token,
      protocol: 'xgen.mcp-relay.v1',
    };
  }

  async stopBrowserRelay(runId: string): Promise<void> {
    if (!this.isRunning() || !this.sessionToken) return;
    await this.request('browser.stop', { runId });
  }

  async readLocalData(key: CoreLocalDataKey): Promise<string | undefined> {
    const result = await this.request('storage.read', { key });
    if (result.state !== 'ready' || (result.content !== null && typeof result.content !== 'string')) {
      throw new Error('XGEN Core returned invalid local data.');
    }
    return typeof result.content === 'string' ? result.content : undefined;
  }

  async writeLocalData(key: CoreLocalDataKey, content: string): Promise<void> {
    const result = await this.request('storage.write', { key, content });
    if (result.state !== 'stored') throw new Error('XGEN Core did not store local data.');
  }

  async stop(): Promise<void> {
    const child = this.child;
    const exitPromise = this.exitPromise;
    if (!child || !exitPromise) return;
    this.stopping = true;
    try {
      if (this.sessionToken) await this.request('shutdown', {});
    } catch {
      // A crashed or incompatible daemon is terminated below.
    }
    child.stdin.end();
    const exited = await Promise.race([
      exitPromise.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2_000)),
    ]);
    if (!exited && !child.killed) child.kill();
    this.stopping = false;
  }

  private async startInternal(): Promise<XgenCoreStatus> {
    const executablePath = await this.findExecutable();
    if (!executablePath) {
      this.statusValue = { available: false, error: 'The XGEN Core daemon was not found.' };
      return this.status();
    }
    this.executablePath = executablePath;
    this.sessionToken = randomBytes(32).toString('hex');
    const child = spawn(executablePath, [], {
      windowsHide: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: coreProcessEnvironment(this.dataRoot),
    });
    this.child = child;
    this.exitPromise = new Promise((resolve) => { this.resolveExit = resolve; });
    this.reader = createInterface({ input: child.stdout, crlfDelay: Infinity });
    this.reader.on('line', (line) => this.handleLine(line));
    child.stderr.resume();
    child.once('error', (error) => this.handleExit(error));
    child.once('exit', (code, signal) => {
      const detail = signal ? `signal ${signal}` : `code ${code ?? 1}`;
      this.handleExit(this.stopping ? undefined : new Error(`XGEN Core exited with ${detail}.`));
    });

    try {
      const handshake = await this.request('handshake', { sessionToken: this.sessionToken }, false);
      if (handshake.service !== 'xgen-core' || handshake.protocolVersion !== 1) {
        throw new Error('XGEN Core returned an incompatible handshake.');
      }
      const health = await this.request('health', {});
      const capabilities = Array.isArray(health.capabilities)
        ? health.capabilities.filter((value): value is string => typeof value === 'string')
        : [];
      this.statusValue = {
        available: true,
        service: 'xgen-core',
        protocolVersion: health.protocolVersion === 1 ? 1 : undefined,
        platform: typeof health.platform === 'string' ? health.platform : undefined,
        architecture: typeof health.architecture === 'string' ? health.architecture : undefined,
        executablePath,
        capabilities,
      };
    } catch (error) {
      this.statusValue = {
        available: false,
        executablePath,
        error: error instanceof Error ? error.message : String(error),
      };
      await this.stop();
    }
    return this.status();
  }

  private request(method: string, params: Record<string, unknown>, authenticated = true): Promise<Record<string, unknown>> {
    const child = this.child;
    if (!child || child.stdin.destroyed) return Promise.reject(new Error('XGEN Core is not running.'));
    const id = randomUUID();
    const payload = {
      protocol: PROTOCOL,
      id,
      method,
      ...(authenticated ? { sessionToken: this.sessionToken } : {}),
      params,
    };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`XGEN Core ${method} timed out.`));
      }, RESPONSE_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(id);
        pending.reject(error);
      });
    });
  }

  private handleLine(line: string): void {
    if (line.length > MAX_RESPONSE_CHARACTERS) {
      this.failPending(new Error('XGEN Core returned an oversized response.'));
      this.child?.kill();
      return;
    }
    let response: CoreResponse;
    try {
      response = JSON.parse(line) as CoreResponse;
    } catch {
      this.failPending(new Error('XGEN Core returned invalid JSON.'));
      this.child?.kill();
      return;
    }
    if (response.protocol !== PROTOCOL || typeof response.id !== 'string') return;
    const pending = this.pending.get(response.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(response.id);
    if (response.ok && response.result) {
      pending.resolve(response.result);
      return;
    }
    const code = response.error?.code ? ` (${response.error.code})` : '';
    pending.reject(new Error(`${response.error?.message ?? 'XGEN Core request failed.'}${code}`));
  }

  private handleExit(error?: Error): void {
    if (!this.child && !this.resolveExit) return;
    this.reader?.close();
    this.reader = undefined;
    this.child = undefined;
    this.sessionToken = undefined;
    this.failPending(error ?? new Error('XGEN Core stopped.'));
    this.resolveExit?.();
    this.resolveExit = undefined;
    this.exitPromise = undefined;
    this.statusValue = {
      available: false,
      executablePath: this.executablePath,
      error: error?.message ?? 'XGEN Core is stopped.',
    };
  }

  private failPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private async findExecutable(): Promise<string | undefined> {
    const binaryName = xgenDaemonBinaryName(currentDesktopPlatform(), currentDesktopArchitecture());
    const candidates = [
      join(process.cwd(), 'bin', binaryName),
      join(process.cwd(), '..', '..', 'bin', binaryName),
      join(this.appPath, '..', '..', 'bin', binaryName),
      join(this.resourcesPath, 'core', binaryName),
    ];
    for (const candidate of candidates) {
      try {
        await access(candidate);
        return candidate;
      } catch {
        // Try the next development or packaged path.
      }
    }
    return undefined;
  }
}

function coreProcessEnvironment(dataRoot: string, environment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const names = process.platform === 'win32'
    ? ['SystemRoot', 'WINDIR', 'TEMP', 'TMP']
    : ['TMPDIR', 'LANG', 'LC_ALL'];
  return {
    ...Object.fromEntries(names.flatMap((name) => environment[name] ? [[name, environment[name]]] : [])),
    XGEN_CORE_DATA_ROOT: dataRoot,
  };
}
