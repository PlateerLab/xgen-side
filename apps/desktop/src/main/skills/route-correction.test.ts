import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeRouteCorrection } from './route-correction';

const sessionId = '18451dcf-4b8a-4348-ae27-67a9258c2748';

test('keeps a correction that names a resolved mode and a session', () => {
  assert.deepEqual(sanitizeRouteCorrection({ routedMode: 'chat', sessionId }), {
    routedMode: 'chat',
    sessionId,
  });
});

test('keeps a correction whose run never reported a session id', () => {
  assert.deepEqual(sanitizeRouteCorrection({ routedMode: 'search' }), {
    routedMode: 'search',
    sessionId: undefined,
  });
});

test('drops a session id that is not one the main process issued', () => {
  assert.equal(
    sanitizeRouteCorrection({ routedMode: 'chat', sessionId: '../../etc/passwd' })?.sessionId,
    undefined,
  );
});

test('drops a correction that names no resolved mode', () => {
  for (const value of [undefined, null, 'chat', {}, { routedMode: 'auto' }, { routedMode: 'nonsense' }]) {
    assert.equal(sanitizeRouteCorrection(value), undefined, JSON.stringify(value));
  }
});
