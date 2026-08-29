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
  // Discovered by pattern rather than listed. A hand-kept list silently drops any
  // test file added later, which is how browser-address and browser-approval-broker
  // came to be absent from the desktop package's own test script.
  test: ['node_modules/tsx/dist/cli.mjs', '--test', 'src/**/*.test.ts'],
};

const args = commands[command];
if (!args) {
  process.stderr.write('Usage: node scripts/xgen-side.mjs <dev|build|preview|typecheck|test>\n');
  process.exit(2);
}

// Electron ships one executable layout per platform. Keep the packaged path in one
// place so the development runner works on Windows, macOS, and Linux alike.
const electronExecutableSegments = {
  win32: ['dist', 'electron.exe'],
  darwin: ['dist', 'Electron.app', 'Contents', 'MacOS', 'Electron'],
}[process.platform] ?? ['dist', 'electron'];

// Editors that embed Electron export ELECTRON_RUN_AS_NODE=1 to their integrated
// terminals. Inheriting it boots Electron as a plain Node runtime, and the ESM main
// process then fails with "The requested module 'electron' does not provide an export
// named 'BrowserWindow'". The desktop shell always needs the full Electron runtime.
delete process.env.ELECTRON_RUN_AS_NODE;
delete process.env.ELECTRON_NO_ATTACH_CONSOLE;

const [entry, ...entryArgs] = args;
const pnpmStore = join(repositoryRoot, 'node_modules', '.pnpm');
if (!process.env.ELECTRON_EXEC_PATH && existsSync(pnpmStore)) {
  const electronPackage = readdirSync(pnpmStore).find((name) => /^electron@\d+\.\d+\.\d+$/.test(name));
  const electronExecutable = electronPackage
    ? join(pnpmStore, electronPackage, 'node_modules', 'electron', ...electronExecutableSegments)
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
