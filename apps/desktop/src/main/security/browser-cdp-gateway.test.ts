import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import test from 'node:test';
import type { WebContents } from 'electron';
import WebSocket from 'ws';
import { openBrowserCdpGateway } from './browser-cdp-gateway';

class FakeDebugger extends EventEmitter {
  private attached = false;
  readonly commands: Array<{ method: string; params?: unknown; sessionId?: string }> = [];

  isAttached(): boolean { return this.attached; }
  attach(): void { this.attached = true; }
  detach(): void { this.attached = false; this.emit('detach'); }
  async sendCommand(method: string, params?: unknown, sessionId?: string): Promise<unknown> {
    this.commands.push({ method, params, sessionId });
    return { value: 42 };
  }
}

test('browser CDP gateway requires an unguessable path and relays direct-page commands', async () => {
  const debuggerApi = new FakeDebugger();
  const contents = { isDestroyed: () => false, debugger: debuggerApi } as unknown as WebContents;
  const gateway = await openBrowserCdpGateway(contents);
  const invalid = new WebSocket(gateway.url.replace(/[^/]+$/, 'wrong-capability'));
  invalid.on('error', () => undefined);
  const [, response] = await once(invalid, 'unexpected-response') as [unknown, { statusCode?: number }];
  assert.equal(response.statusCode, 404);

  const socket = new WebSocket(gateway.url);
  await once(socket, 'open');
  socket.send(JSON.stringify({ id: 7, method: 'Runtime.evaluate', params: { expression: '6 * 7' } }));
  const [message] = await once(socket, 'message');
  assert.deepEqual(JSON.parse(message.toString()), { id: 7, result: { value: 42 } });
  assert.deepEqual(debuggerApi.commands, [{ method: 'Runtime.evaluate', params: { expression: '6 * 7' }, sessionId: undefined }]);

  socket.close();
  await gateway.close();
  assert.equal(debuggerApi.isAttached(), false);
});
