#!/usr/bin/env node

import { copyFileSync, existsSync, chmodSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { arch, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(scriptDirectory, '..');
const extension = platform() === 'win32' ? '.exe' : '';
const sourcePath = join(repositoryRoot, 'crates', 'xgen-daemon', 'target', 'release', `xgen-daemon${extension}`);
const binDirectory = join(repositoryRoot, 'bin');
const targetPath = join(binDirectory, `xgen-daemon-${platform()}-${arch()}${extension}`);
const temporaryPath = `${targetPath}.new-${process.pid}`;

if (!existsSync(sourcePath)) {
  process.stderr.write(`XGEN Core daemon was not found at ${sourcePath}.\n`);
  process.exit(1);
}

mkdirSync(binDirectory, { recursive: true });
rmSync(temporaryPath, { force: true });
copyFileSync(sourcePath, temporaryPath);
if (platform() !== 'win32') chmodSync(temporaryPath, 0o755);

try {
  renameSync(temporaryPath, targetPath);
} catch (error) {
  if (platform() !== 'win32') throw error;
  rmSync(targetPath, { force: true });
  renameSync(temporaryPath, targetPath);
}

process.stdout.write(`Copied XGEN Core daemon to ${targetPath}\n`);
