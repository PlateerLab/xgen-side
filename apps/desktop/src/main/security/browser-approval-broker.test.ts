import assert from 'node:assert/strict';
import { connect } from 'node:net';
import test from 'node:test';
import { BrowserApprovalBroker } from './browser-approval-broker';

function request(address: string, payload: object): Promise<{ decision: string }> {
  return new Promise((resolve, reject) => {
    const socket = connect(Number(address.split(':')[1]), '127.0.0.1');
    let response = '';
    socket.setEncoding('utf8');
    socket.once('error', reject);
    socket.on('data', (chunk: string) => { response += chunk; });
    socket.on('end', () => resolve(JSON.parse(response.trim()) as { decision: string }));
    socket.once('connect', () => socket.write(`${JSON.stringify(payload)}\n`));
  });
}

test('only the registered run can resolve a one-shot approval', async () => {
  const broker = new BrowserApprovalBroker();
  await broker.start();
  let approvalId = '';
  const connection = broker.registerRun('run-1', (approval) => { approvalId = approval.id; });
  const result = request(connection.address, {
    runId: 'run-1', token: connection.token, confirmationId: 'engine-1', action: 'upload', detail: '{"files":["invoice.pdf"]}',
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(approvalId);
  assert.equal(broker.respond('other-run', approvalId, 'allow'), false);
  assert.equal(broker.respond('run-1', approvalId, 'allow'), true);
  assert.deepEqual(await result, { decision: 'allow' });
  assert.equal(broker.respond('run-1', approvalId, 'allow'), false);
  await broker.close();
});

test('rejects an invalid token without creating an approval', async () => {
  const broker = new BrowserApprovalBroker();
  await broker.start();
  let requested = false;
  const connection = broker.registerRun('run-1', () => { requested = true; });
  const result = await request(connection.address, {
    runId: 'run-1', token: 'invalid', confirmationId: 'engine-1', action: 'download',
  });
  assert.deepEqual(result, { decision: 'deny' });
  assert.equal(requested, false);
  await broker.close();
});

test('unregistering a run fails pending approvals closed', async () => {
  const broker = new BrowserApprovalBroker();
  await broker.start();
  const connection = broker.registerRun('run-1', () => undefined);
  const result = request(connection.address, {
    runId: 'run-1', token: connection.token, confirmationId: 'engine-1', action: 'download',
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  broker.unregisterRun('run-1');
  assert.deepEqual(await result, { decision: 'deny' });
  await broker.close();
});
