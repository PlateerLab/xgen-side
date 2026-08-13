import assert from 'node:assert/strict';
import test from 'node:test';
import {
  credentialOriginMatches,
  normalizeCredentialOrigin,
  validateCredentialSaveRequest,
} from './credential-policy';

test('normalizes an origin without retaining path, query, or fragment', () => {
  assert.equal(
    normalizeCredentialOrigin('https://EXAMPLE.com:443/login?next=%2Fsettings#form'),
    'https://example.com',
  );
});

test('requires an exact scheme, host, and effective port match', () => {
  assert.equal(credentialOriginMatches('https://example.com', 'https://example.com/account'), true);
  assert.equal(credentialOriginMatches('https://example.com', 'http://example.com/account'), false);
  assert.equal(credentialOriginMatches('https://example.com', 'https://auth.example.com/account'), false);
  assert.equal(credentialOriginMatches('https://example.com', 'https://example.com.evil.test/account'), false);
  assert.equal(credentialOriginMatches('https://example.com:8443', 'https://example.com/account'), false);
});

test('rejects insecure non-loopback and credential-bearing origins', () => {
  assert.throws(() => normalizeCredentialOrigin('file:///tmp/login.html'));
  assert.throws(() => normalizeCredentialOrigin('http://example.com/login'));
  assert.throws(() => normalizeCredentialOrigin('https://user:password@example.com/login'));
});

test('permits HTTP only for exact loopback hosts', () => {
  assert.equal(normalizeCredentialOrigin('http://localhost:3000/login'), 'http://localhost:3000');
  assert.equal(normalizeCredentialOrigin('http://127.0.0.1/login'), 'http://127.0.0.1');
  assert.equal(normalizeCredentialOrigin('http://[::1]/login'), 'http://[::1]');
  assert.throws(() => normalizeCredentialOrigin('http://local.example/login'));
  assert.throws(() => normalizeCredentialOrigin('http://127.0.0.2/login'));
});

test('validates a save request and returns only its canonical origin', () => {
  const request = validateCredentialSaveRequest({
    label: 'Work account',
    origin: 'https://example.com/login',
    username: 'person@example.com',
    password: 'correct horse battery staple',
  });

  assert.equal(request.origin, 'https://example.com');
  assert.equal(request.label, 'Work account');
});

test('rejects empty secrets and control characters in labels', () => {
  assert.throws(() => validateCredentialSaveRequest({
    label: 'Bad\nlabel',
    origin: 'https://example.com',
    username: 'person@example.com',
    password: 'secret',
  }));
  assert.throws(() => validateCredentialSaveRequest({
    label: 'Account',
    origin: 'https://example.com',
    username: 'person@example.com',
    password: '',
  }));
});
