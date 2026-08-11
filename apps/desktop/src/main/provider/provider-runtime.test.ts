import assert from 'node:assert/strict';
import test from 'node:test';
import { collect, safeEnvironment } from './provider-runtime';

test('collect emits complete stdout lines while preserving the full output', async () => {
  const lines: string[] = [];
  const result = await collect(
    process.execPath,
    ['-e', "process.stdout.write('first\\nsec'); setTimeout(() => process.stdout.write('ond\\n'), 10)"],
    process.cwd(),
    undefined,
    5_000,
    safeEnvironment(),
    { onStdoutLine: (line) => lines.push(line) },
  );
  assert.equal(result.exitCode, 0);
  assert.equal(result.cancelled, false);
  assert.equal(result.stdout, 'first\nsecond\n');
  assert.deepEqual(lines, ['first', 'second']);
});

test('collect stops an active process when its signal is aborted', async () => {
  const controller = new AbortController();
  const resultPromise = collect(
    process.execPath,
    ['-e', 'setTimeout(() => {}, 5000)'],
    process.cwd(),
    undefined,
    10_000,
    safeEnvironment(),
    { signal: controller.signal },
  );
  setTimeout(() => controller.abort(), 30);
  const result = await resultPromise;
  assert.equal(result.cancelled, true);
  assert.notEqual(result.exitCode, 0);
});
