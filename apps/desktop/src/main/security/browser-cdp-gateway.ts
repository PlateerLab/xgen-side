import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { WebContents } from 'electron';
import { WebSocket, WebSocketServer } from 'ws';

const MAX_CDP_MESSAGE_BYTES = 8 * 1024 * 1024;

export interface BrowserCdpGatewayConnection {
  url: string;
  close(): Promise<void>;
}

/**
 * Exposes one Electron WebContents debugger as a one-run, capability-authenticated
 * direct-page CDP WebSocket. The raw debugger is never published on Electron's
 * process-wide remote debugging port.
 */
export async function openBrowserCdpGateway(contents: WebContents): Promise<BrowserCdpGatewayConnection> {
  if (contents.isDestroyed() || contents.debugger.isAttached()) {
    throw new Error('The browser tab debugger is unavailable.');
  }

  const capability = randomBytes(32).toString('hex');
  const expectedPath = `/xgen-cdp/${capability}`;
  const server = createServer((_request, response) => {
    response.writeHead(404, { 'cache-control': 'no-store', connection: 'close' });
    response.end();
  });
  const webSockets = new WebSocketServer({ noServer: true, maxPayload: MAX_CDP_MESSAGE_BYTES });
  let activeSocket: WebSocket | undefined;
  let closed = false;

  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    activeSocket?.close(1001, 'gateway closed');
    webSockets.close();
    if (!contents.isDestroyed() && contents.debugger.isAttached()) contents.debugger.detach();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };

  server.on('upgrade', (request, socket, head) => {
    const path = request.url?.split('?', 1)[0] ?? '';
    if (closed || !timingSafePathEqual(path, expectedPath)) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    if (activeSocket) {
      activeSocket.terminate();
      activeSocket = undefined;
    }
    webSockets.handleUpgrade(request, socket, head, (webSocket) => webSockets.emit('connection', webSocket, request));
  });

  webSockets.on('connection', (socket) => {
    activeSocket = socket;
    socket.on('message', (data, isBinary) => {
      if (isBinary) {
        socket.close(1003, 'text messages required');
        return;
      }
      void forwardCdpCommand(contents, socket, data.toString());
    });
    socket.once('close', () => {
      if (activeSocket === socket) activeSocket = undefined;
    });
  });

  const onDebuggerMessage = (_event: unknown, method: string, params: unknown, sessionId?: string): void => {
    if (!activeSocket || activeSocket.readyState !== WebSocket.OPEN) return;
    activeSocket.send(JSON.stringify({ method, params, ...(sessionId ? { sessionId } : {}) }));
  };
  const onDebuggerDetach = (): void => {
    activeSocket?.close(1011, 'debugger detached');
  };
  contents.debugger.on('message', onDebuggerMessage);
  contents.debugger.on('detach', onDebuggerDetach);

  try {
    contents.debugger.attach('1.3');
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
  } catch (error) {
    contents.debugger.removeListener('message', onDebuggerMessage);
    contents.debugger.removeListener('detach', onDebuggerDetach);
    if (contents.debugger.isAttached()) contents.debugger.detach();
    server.close();
    throw error;
  }

  const address = server.address() as AddressInfo;
  return {
    url: `ws://127.0.0.1:${address.port}${expectedPath}`,
    close: async () => {
      contents.debugger.removeListener('message', onDebuggerMessage);
      contents.debugger.removeListener('detach', onDebuggerDetach);
      await close();
    },
  };
}

interface CdpRequest {
  id: number;
  method: string;
  params?: Record<string, unknown>;
  sessionId?: string;
}

async function forwardCdpCommand(contents: WebContents, socket: WebSocket, input: string): Promise<void> {
  let request: CdpRequest | undefined;
  try {
    const value = JSON.parse(input) as unknown;
    if (!isCdpRequest(value)) throw new Error('Invalid CDP request.');
    request = value;
    const result = await contents.debugger.sendCommand(value.method, value.params, value.sessionId);
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id: value.id, result }));
  } catch (error) {
    if (!request || socket.readyState !== WebSocket.OPEN) return;
    const message = error instanceof Error ? error.message : 'CDP command failed.';
    socket.send(JSON.stringify({ id: request.id, error: { code: -32000, message: message.slice(0, 2_000) } }));
  }
}

function isCdpRequest(value: unknown): value is CdpRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return Number.isSafeInteger(input.id)
    && typeof input.method === 'string'
    && /^[A-Za-z][A-Za-z0-9_.]{0,127}$/.test(input.method)
    && (input.params === undefined || (typeof input.params === 'object' && input.params !== null && !Array.isArray(input.params)))
    && (input.sessionId === undefined || (typeof input.sessionId === 'string' && input.sessionId.length <= 256));
}

function timingSafePathEqual(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}
