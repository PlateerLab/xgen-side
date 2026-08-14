import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const cargoName = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
const rustupCargo = join(homedir(), '.cargo', 'bin', cargoName);
const cargo = process.env.CARGO || (existsSync(rustupCargo) ? rustupCargo : cargoName);
const operation = process.argv[2] === 'test' ? 'test' : 'build';
const manifests = operation === 'test'
  ? ['crates/xgen-core/Cargo.toml', 'crates/xgen-daemon/Cargo.toml']
  : ['crates/xgen-daemon/Cargo.toml'];

for (const manifest of manifests) {
  const result = spawnSync(cargo, [
    operation,
    ...(operation === 'build' ? ['--release'] : []),
    '--manifest-path',
    manifest,
  ], {
    cwd: repositoryRoot,
    env: process.env,
    shell: false,
    stdio: 'inherit',
  });
  if (result.error) {
    process.stderr.write(`Could not start Cargo: ${result.error.message}\n`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (operation === 'test') process.exit(0);

const copy = spawnSync(process.execPath, ['scripts/copy-xgen-daemon.js'], {
  cwd: repositoryRoot,
  env: process.env,
  shell: false,
  stdio: 'inherit',
});
if (copy.error) {
  process.stderr.write(`Could not copy XGEN Core: ${copy.error.message}\n`);
  process.exit(1);
}
process.exit(copy.status ?? 1);
