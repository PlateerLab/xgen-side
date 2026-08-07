import { spawnSync } from 'node:child_process';
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
    'src/main/skills/skill-router.test.ts',
  ],
};

const args = commands[command];
if (!args) {
  process.stderr.write('Usage: node scripts/xgen-side.mjs <dev|build|preview|typecheck|test>\n');
  process.exit(2);
}

const [entry, ...entryArgs] = args;
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
