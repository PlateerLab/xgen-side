import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const desktopRoot = join(repositoryRoot, 'apps', 'desktop');
const command = process.argv[2];

const commands = {
  dev: ['node_modules/electron-vite/bin/electron-vite.js', 'dev'],
  build: ['node_modules/electron-vite/bin/electron-vite.js', 'build'],
  preview: ['node_modules/electron-vite/bin/electron-vite.js', 'preview'],
  typecheck: ['node_modules/typescript/bin/tsc', '--noEmit'],
  test: [
    'node_modules/tsx/dist/cli.mjs',
    '--test',
    'src/main/security/policy-engine.test.ts',
    'src/main/command/command-broker.test.ts',
    'src/main/provider/provider-adapter.test.ts',
    'src/main/provider/provider-runtime.test.ts',
    'src/main/skills/skill-router.test.ts',
  ],
};

const args = commands[command];
if (!args) {
  process.stderr.write('Usage: node scripts/xgen-side.mjs <dev|build|preview|typecheck|test>\n');
  process.exit(2);
}

const [entry, ...entryArgs] = args;
const pnpmStore = join(repositoryRoot, 'node_modules', '.pnpm');
if (!process.env.ELECTRON_EXEC_PATH && existsSync(pnpmStore)) {
  const electronPackage = readdirSync(pnpmStore).find((name) => /^electron@\d+\.\d+\.\d+$/.test(name));
  const electronExecutable = electronPackage
    ? join(pnpmStore, electronPackage, 'node_modules', 'electron', 'dist', 'electron.exe')
    : '';
  if (electronExecutable && existsSync(electronExecutable)) process.env.ELECTRON_EXEC_PATH = electronExecutable;
}
const result = spawnSync(process.execPath, [entry, ...entryArgs], {
  cwd: desktopRoot,
  env: process.env,
  shell: false,
  stdio: 'inherit',
});

if (result.error) {
  process.stderr.write(`${result.error.message}\n`);
  process.exit(1);
}
process.exit(result.status ?? 1);
