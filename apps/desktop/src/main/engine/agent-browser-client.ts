import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import type { EngineStatus } from '../../shared/contracts';

const binaryName = process.arch === 'arm64'
  ? 'agent-browser-win32-arm64.exe'
  : 'agent-browser-win32-x64.exe';

export class AgentBrowserClient {
  async status(): Promise<EngineStatus> {
    const executablePath = await this.findExecutable();
    if (!executablePath) {
      return {
        available: false,
        error: 'The agent-browser native engine was not found.',
      };
    }

    try {
      const version = await readVersion(executablePath);
      return { available: true, version, executablePath };
    } catch (error) {
      return {
        available: false,
        executablePath,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async findExecutable(): Promise<string | undefined> {
    const candidates = [
      join(process.cwd(), 'bin', binaryName),
      join(process.cwd(), '..', '..', 'bin', binaryName),
      join(app.getAppPath(), '..', '..', 'bin', binaryName),
      join(process.resourcesPath, 'engine', binaryName),
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

function readVersion(executablePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executablePath, ['--version'], {
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `Engine exited with code ${code ?? 1}.`));
    });
  });
}
