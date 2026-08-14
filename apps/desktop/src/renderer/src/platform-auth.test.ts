import assert from 'node:assert/strict';
import test from 'node:test';
import { detectDesktopAuthPlatform, platformAuthCopy, qrAuthCopy } from './platform-auth';

test('uses Touch ID copy on macOS', () => {
  const platform = detectDesktopAuthPlatform('Mozilla/5.0', 'MacIntel');
  assert.equal(platform, 'macos');
  assert.match(platformAuthCopy(platform).title, /Touch ID/);
});

test('uses Windows Hello copy on Windows', () => {
  const platform = detectDesktopAuthPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
  assert.equal(platform, 'windows');
  assert.match(platformAuthCopy(platform).title, /Windows Hello/);
});

test('uses site QR verification copy independently from the desktop platform', () => {
  assert.match(qrAuthCopy().title, /QR/);
  assert.match(qrAuthCopy().detail, /네이버 앱/);
});
