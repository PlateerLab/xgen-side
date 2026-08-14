import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AppSettings } from '../../shared/contracts';
import type { CoreBlobStore } from './core-blob-store';

const defaults: AppSettings = {
  schemaVersion: 1,
  general: { defaultPermissionMode: 'guard', localLogs: true, compact: false },
  browserPermissions: { upload: 'ask', download: 'ask' },
  mcpEnabled: { browser: true, xgen: true, filesystem: false },
  skillEnabled: {},
};

export class LocalSettingsStore {
  private readonly path: string;

  constructor(
    path: string,
    private readonly blobs?: CoreBlobStore,
  ) {
    this.path = path;
  }

  async load(): Promise<AppSettings> {
    try {
      const coreValue = await this.blobs?.readLocalData('settings');
      const legacyValue = coreValue === undefined ? await readFile(this.path, 'utf8') : undefined;
      const safe = sanitizeSettings(JSON.parse(coreValue ?? legacyValue ?? ''));
      if (this.blobs && coreValue === undefined) await this.blobs.writeLocalData('settings', JSON.stringify(safe));
      return safe;
    } catch {
      return structuredClone(defaults);
    }
  }

  async save(settings: AppSettings): Promise<AppSettings> {
    const safe = sanitizeSettings(settings);
    if (this.blobs) {
      await this.blobs.writeLocalData('settings', JSON.stringify(safe));
      return safe;
    }
    await mkdir(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(safe, null, 2), 'utf8');
    await rename(temporaryPath, this.path);
    return safe;
  }
}

function sanitizeSettings(value: unknown): AppSettings {
  const input = isRecord(value) ? value : {};
  const general = isRecord(input.general) ? input.general : {};
  return {
    schemaVersion: 1,
    general: {
      defaultPermissionMode: permissionModeValue(general.defaultPermissionMode, general.guard),
      localLogs: booleanValue(general.localLogs, defaults.general.localLogs),
      compact: booleanValue(general.compact, defaults.general.compact),
    },
    browserPermissions: permissionSettings(input.browserPermissions),
    mcpEnabled: booleanRecord(input.mcpEnabled, defaults.mcpEnabled),
    skillEnabled: booleanRecord(input.skillEnabled, defaults.skillEnabled),
  };
}

function permissionSettings(value: unknown): AppSettings['browserPermissions'] {
  const input = isRecord(value) ? value : {};
  return {
    upload: permissionValue(input.upload, defaults.browserPermissions.upload),
    download: permissionValue(input.download, defaults.browserPermissions.download),
  };
}

function permissionValue(value: unknown, fallback: AppSettings['browserPermissions']['upload']): AppSettings['browserPermissions']['upload'] {
  return value === 'allow' || value === 'ask' || value === 'deny' ? value : fallback;
}

function permissionModeValue(value: unknown, legacyGuard: unknown): AppSettings['general']['defaultPermissionMode'] {
  if (value === 'read-only' || value === 'guard' || value === 'full-access') return value;
  if (typeof legacyGuard === 'boolean') return legacyGuard ? 'guard' : 'full-access';
  return defaults.general.defaultPermissionMode;
}

function booleanRecord(value: unknown, fallback: Record<string, boolean>): Record<string, boolean> {
  if (!isRecord(value)) return { ...fallback };
  const result: Record<string, boolean> = {};
  for (const [key, enabled] of Object.entries(value).slice(0, 1_000)) {
    if (/^[A-Za-z0-9._:-]{1,100}$/.test(key) && typeof enabled === 'boolean') result[key] = enabled;
  }
  return { ...fallback, ...result };
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
