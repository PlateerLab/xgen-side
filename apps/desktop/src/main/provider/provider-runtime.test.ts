import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collect, locateNativeExecutable, safeEnvironment } from './provider-runtime';

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

test('collect completes after a terminal stdout line even when the process stays alive', async () => {
  const startedAt = Date.now();
  const result = await collect(
    process.execPath,
    ['-e', "console.log('streaming'); console.log('turn.completed'); setTimeout(() => {}, 5000)"],
    process.cwd(),
    undefined,
    10_000,
    safeEnvironment(),
    { stopAfterStdoutLine: (line) => line === 'turn.completed' },
  );
  assert.equal(result.exitCode, 0);
  assert.equal(result.cancelled, false);
  assert.match(result.stdout, /turn\.completed/);
  assert.ok(Date.now() - startedAt < 3_000);
});

test(
  'locateNativeExecutable resolves PATH entries and skips directories with the same name',
  { skip: process.platform === 'win32' },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'xgen-path-'));
    const shadowDir = join(root, 'shadow');
    const binDir = join(root, 'bin');
    await mkdir(join(shadowDir, 'xgen-fake-tool'), { recursive: true });
    await mkdir(binDir, { recursive: true });
    const tool = join(binDir, 'xgen-fake-tool');
    await writeFile(tool, '#!/bin/sh\necho fake 1.0\n', { mode: 0o755 });

    const originalPath = process.env.PATH;
    process.env.PATH = `${shadowDir}:${binDir}`;
    try {
      const found = await locateNativeExecutable('xgen-fake-tool');
      assert.equal(found?.path, tool);
      assert.equal(found?.version, 'fake 1.0');
    } finally {
      process.env.PATH = originalPath;
      await rm(root, { recursive: true, force: true });
    }
  },
);
