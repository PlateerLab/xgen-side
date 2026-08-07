import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { app } from 'electron';
import type { AppSettings } from '../../shared/contracts';

const defaults: AppSettings = {
  schemaVersion: 1,
  general: { guard: true, localLogs: true, compact: false },
  mcpEnabled: { browser: true, xgen: true, filesystem: false },
  skillEnabled: {},
};

export class LocalSettingsStore {
  private readonly path: string;

  constructor(path = join(app.getPath('userData'), 'agent-data', 'settings.json')) {
    this.path = path;
  }

  async load(): Promise<AppSettings> {
    try {
      const saved = JSON.parse(await readFile(this.path, 'utf8')) as unknown;
      return sanitizeSettings(saved);
    } catch {
      return structuredClone(defaults);
    }
  }

  async save(settings: AppSettings): Promise<AppSettings> {
    const safe = sanitizeSettings(settings);
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
      guard: booleanValue(general.guard, defaults.general.guard),
      localLogs: booleanValue(general.localLogs, defaults.general.localLogs),
      compact: booleanValue(general.compact, defaults.general.compact),
    },
    mcpEnabled: booleanRecord(input.mcpEnabled, defaults.mcpEnabled),
    skillEnabled: booleanRecord(input.skillEnabled, defaults.skillEnabled),
  };
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
