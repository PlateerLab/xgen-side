import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { arch, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const hostPlatform = platform();
const hostArchitecture = arch() === 'arm64' ? 'arm64' : 'x64';

if (hostPlatform !== 'darwin' && hostPlatform !== 'win32') {
  process.stderr.write(`XGEN Side packaging is supported only on macOS and Windows, not ${hostPlatform}.\n`);
  process.exit(1);
}

const extension = hostPlatform === 'win32' ? '.exe' : '';
const requiredFiles = [
  join(repositoryRoot, 'bin', `agent-browser-${hostPlatform}-${hostArchitecture}${extension}`),
  join(repositoryRoot, 'bin', `xgen-daemon-${hostPlatform}-${hostArchitecture}${extension}`),
  join(repositoryRoot, 'apps', 'desktop', 'resources', 'xgen-browser-provider.cjs'),
  join(repositoryRoot, 'apps', 'desktop', 'resources', 'xgen-credential-plugin.cjs'),
  join(repositoryRoot, 'apps', 'desktop', 'resources', 'xgen-mcp-bridge.cjs'),
];

for (const path of requiredFiles) {
  try {
    await access(path, hostPlatform === 'win32' || path.endsWith('.cjs') ? constants.R_OK : constants.R_OK | constants.X_OK);
  } catch {
    process.stderr.write(`Required packaged resource is unavailable: ${path}\n`);
    process.exit(1);
  }
}

process.stdout.write(`XGEN Side package resources verified for ${hostPlatform}-${hostArchitecture}.\n`);
