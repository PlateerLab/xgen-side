import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';
import type { CredentialAutofillResult } from '../../shared/contracts';

interface CredentialInjectionAccess {
  inject(
    runId: string,
    tabId: string,
    pageUrl: string,
    itemRef?: string,
  ): Promise<CredentialAutofillResult>;
}

interface RunRegistration {
  token: string;
  tabId: string;
  used: boolean;
  onRequest(request: CredentialApprovalRequest): void;
}

interface PendingApproval {
  runId: string;
  resolve(decision: 'allow' | 'deny'): void;
  timer: NodeJS.Timeout;
}

export interface CredentialBrokerConnection {
  address: string;
  token: string;
}

export interface CredentialApprovalRequest {
  id: string;
  runId: string;
  action: 'auth_login';
  detail: string;
}

/**
 * Performs at most one approved exact-origin credential injection for one Agent
 * Run. Password plaintext remains inside the desktop main process and is never
 * returned over the loopback protocol, IPC, MCP, provider stdout, or model text.
 */
export class CredentialBroker {
  private readonly registrations = new Map<string, RunRegistration>();
  private readonly pending = new Map<string, PendingApproval>();
  private server: Server | undefined;
  private port: number | undefined;

  constructor(private readonly injection: CredentialInjectionAccess) {}

  async start(): Promise<void> {
    if (this.server) return;
    const server = createServer((socket) => this.accept(socket));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      throw new Error('Could not start the credential broker.');
    }
    this.server = server;
    this.port = address.port;
  }

  registerRun(runId: string, tabId: string, onRequest: (request: CredentialApprovalRequest) => void): CredentialBrokerConnection {
    if (!this.port) throw new Error('Credential broker is not ready.');
    const token = randomBytes(32).toString('hex');
    this.registrations.set(runId, { token, tabId, used: false, onRequest });
    return { address: `127.0.0.1:${this.port}`, token };
  }

  unregisterRun(runId: string): void {
    this.registrations.delete(runId);
    for (const [id, approval] of this.pending) {
      if (approval.runId === runId) this.finishApproval(id, 'deny');
    }
  }

  respond(runId: string, approvalId: string, decision: 'allow' | 'deny'): boolean {
    const approval = this.pending.get(approvalId);
    if (!approval || approval.runId !== runId) return false;
    this.finishApproval(approvalId, decision);
    return true;
  }

  async close(): Promise<void> {
    for (const id of [...this.pending.keys()]) this.finishApproval(id, 'deny');
    this.registrations.clear();
    const server = this.server;
    this.server = undefined;
    this.port = undefined;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private accept(socket: Socket): void {
    socket.setEncoding('utf8');
    socket.setTimeout(125_000, () => socket.destroy());
    let input = '';
    socket.on('data', (chunk: string) => {
      input += chunk;
      if (input.length > 16_384) {
        socket.destroy();
        return;
      }
      const newline = input.indexOf('\n');
      if (newline < 0) return;
      const line = input.slice(0, newline);
      input = '';
      void this.handleRequest(socket, line);
    });
  }

  private async handleRequest(socket: Socket, line: string): Promise<void> {
    let value: unknown;
    try { value = JSON.parse(line); } catch { socket.destroy(); return; }
    if (!isCredentialRequest(value)) {
      socket.end(`${JSON.stringify({ state: 'denied' })}\n`);
      return;
    }
    const registration = this.registrations.get(value.runId);
    if (!registration || registration.used || !timingSafeTextEqual(value.token, registration.token)) {
      socket.end(`${JSON.stringify({ state: 'denied' })}\n`);
      return;
    }
    const pageUrl = normalizePageUrl(value.url);
    if (!pageUrl) {
      socket.end(`${JSON.stringify({ state: 'denied' })}\n`);
      return;
    }
    try {
      registration.used = true;
      const decision = await this.requestApproval(value.runId, registration, new URL(pageUrl).origin);
      if (decision !== 'allow') throw new CredentialApprovalDeniedError();
      const result = await this.injection.inject(value.runId, registration.tabId, pageUrl, value.itemRef);
      if (result.state !== 'filled') {
        socket.end(`${JSON.stringify({ state: result.state })}\n`);
        return;
      }
      socket.end(`${JSON.stringify({ state: 'used', injection: result })}\n`);
    } catch (error) {
      const state = error instanceof CredentialApprovalDeniedError
        ? 'denied'
        : error instanceof Error && error.name === 'CredentialVaultUnavailableError'
          ? 'unavailable'
          : 'failed';
      socket.end(`${JSON.stringify({ state })}\n`);
    }
  }

  private requestApproval(runId: string, registration: RunRegistration, origin: string): Promise<'allow' | 'deny'> {
    const id = `${runId}:credential:${randomUUID()}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.finishApproval(id, 'deny'), 120_000);
      this.pending.set(id, { runId, resolve, timer });
      registration.onRequest({
        id,
        runId,
        action: 'auth_login',
        detail: JSON.stringify({ origin }),
      });
    });
  }

  private finishApproval(id: string, decision: 'allow' | 'deny'): void {
    const approval = this.pending.get(id);
    if (!approval) return;
    clearTimeout(approval.timer);
    this.pending.delete(id);
    approval.resolve(decision);
  }
}

class CredentialApprovalDeniedError extends Error {}

function normalizePageUrl(input: string): string | undefined {
  if (input.length > 4_096) return undefined;
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    url.username = '';
    url.password = '';
    return url.toString();
  } catch {
    return undefined;
  }
}

function isCredentialRequest(value: unknown): value is { runId: string; token: string; profileName: string; itemRef?: string; url: string } {
  if (!isRecord(value)) return false;
  return typeof value.runId === 'string'
    && /^[A-Za-z0-9._:-]{1,160}$/.test(value.runId)
    && typeof value.token === 'string'
    && /^[0-9a-f]{64}$/.test(value.token)
    && typeof value.profileName === 'string'
    && value.profileName.length <= 200
    && (value.itemRef === undefined || (typeof value.itemRef === 'string' && value.itemRef.length <= 200))
    && typeof value.url === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function timingSafeTextEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  let difference = 0;
  for (let index = 0; index < leftBuffer.length; index += 1) difference |= leftBuffer[index]! ^ rightBuffer[index]!;
  return difference === 0;
}
