import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';
import type { PolicyDecision } from '../../shared/contracts';

interface RunRegistration {
  token: string;
  onRequest(request: BrowserApprovalRequest): void;
}

interface PendingApproval {
  runId: string;
  socket: Socket;
  timer: NodeJS.Timeout;
}

export interface BrowserApprovalRequest {
  id: string;
  runId: string;
  action: string;
  detail?: string;
}

export interface BrowserApprovalConnection {
  address: string;
  token: string;
}

export class BrowserApprovalBroker {
  private readonly registrations = new Map<string, RunRegistration>();
  private readonly pending = new Map<string, PendingApproval>();
  private server: Server | undefined;
  private port: number | undefined;

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
      throw new Error('Could not start the browser approval broker.');
    }
    this.server = server;
    this.port = address.port;
  }

  registerRun(runId: string, onRequest: (request: BrowserApprovalRequest) => void): BrowserApprovalConnection {
    if (!this.port) throw new Error('Browser approval broker is not ready.');
    const token = randomBytes(32).toString('hex');
    this.registrations.set(runId, { token, onRequest });
    return { address: `127.0.0.1:${this.port}`, token };
  }

  unregisterRun(runId: string): void {
    this.registrations.delete(runId);
    for (const [id, approval] of this.pending) {
      if (approval.runId === runId) this.finish(id, 'deny');
    }
  }

  respond(runId: string, approvalId: string, decision: Extract<PolicyDecision, 'allow' | 'deny'>): boolean {
    const pending = this.pending.get(approvalId);
    if (!pending || pending.runId !== runId) return false;
    this.finish(approvalId, decision);
    return true;
  }

  async close(): Promise<void> {
    for (const id of [...this.pending.keys()]) this.finish(id, 'deny');
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
      this.handleRequest(socket, line);
    });
  }

  private handleRequest(socket: Socket, line: string): void {
    let value: unknown;
    try { value = JSON.parse(line); } catch { socket.destroy(); return; }
    if (!isRecord(value) || typeof value.runId !== 'string' || typeof value.token !== 'string' || typeof value.confirmationId !== 'string' || typeof value.action !== 'string') {
      socket.destroy();
      return;
    }
    const registration = this.registrations.get(value.runId);
    if (!registration || !timingSafeTextEqual(value.token, registration.token)) {
      socket.end(`${JSON.stringify({ decision: 'deny' })}
`);
      return;
    }
    const id = `${value.runId}:${value.confirmationId}:${randomUUID()}`;
    const timer = setTimeout(() => this.finish(id, 'deny'), 120_000);
    this.pending.set(id, { runId: value.runId, socket, timer });
    socket.once('close', () => {
      const pending = this.pending.get(id);
      if (pending?.socket === socket) {
        clearTimeout(pending.timer);
        this.pending.delete(id);
      }
    });
    registration.onRequest({
      id,
      runId: value.runId,
      action: value.action.slice(0, 100),
      detail: typeof value.detail === 'string' ? value.detail.slice(0, 2_000) : undefined,
    });
  }

  private finish(id: string, decision: 'allow' | 'deny'): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    pending.socket.end(`${JSON.stringify({ decision })}
`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function timingSafeTextEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function timingSafeEqual(left: Buffer, right: Buffer): boolean {
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index]! ^ right[index]!;
  return difference === 0;
}
