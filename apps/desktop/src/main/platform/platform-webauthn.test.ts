import assert from 'node:assert/strict';
import test from 'node:test';
import { configurePlatformWebAuthn, passkeyAgentInstruction, platformPasskeyStatus } from './platform-webauthn';

test('enables Windows Hello without a macOS entitlement', () => {
  const status = platformPasskeyStatus('win32');
  assert.deepEqual(status, { available: true, method: 'windows-hello' });
  assert.match(passkeyAgentInstruction(status), /Windows Hello/);
});

test('requires a signed keychain access group for macOS Touch ID', () => {
  const status = platformPasskeyStatus('darwin', undefined);
  assert.equal(status.available, false);
  assert.equal(status.method, 'external-only');
});

test('configures macOS WebAuthn with the validated access group', () => {
  const previous = process.env.XGEN_SIDE_WEBAUTHN_KEYCHAIN_ACCESS_GROUP;
  process.env.XGEN_SIDE_WEBAUTHN_KEYCHAIN_ACCESS_GROUP = 'A1B2C3D4E5.com.xgen.side.webauthn';
  let configured: unknown;
  const status = configurePlatformWebAuthn({ configureWebAuthn: (options: unknown) => { configured = options; } } as never, 'darwin');
  assert.equal(status.available, true);
  assert.deepEqual(configured, {
    touchID: {
      keychainAccessGroup: 'A1B2C3D4E5.com.xgen.side.webauthn',
      promptReason: 'sign in to $1',
    },
  });
  if (previous === undefined) delete process.env.XGEN_SIDE_WEBAUTHN_KEYCHAIN_ACCESS_GROUP;
  else process.env.XGEN_SIDE_WEBAUTHN_KEYCHAIN_ACCESS_GROUP = previous;
});
