import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { app, safeStorage } from 'electron';
import type { CredentialSaveRequest, CredentialSummary, CredentialVaultStatus } from '../../shared/contracts';
import {
  credentialOriginMatches,
  normalizeCredentialOrigin,
  validateCredentialId,
  validateCredentialSaveRequest,
} from '../security/credential-policy';

const MAX_VAULT_ENTRIES = 1_000;
const MAX_VAULT_FILE_CHARACTERS = 64 * 1024 * 1024;

interface EncryptedCredentialEntry {
  id: string;
  ciphertext: string;
}

interface CredentialVaultDocument {
  schemaVersion: 1;
  entries: EncryptedCredentialEntry[];
}

interface DecryptedCredentialEntry extends CredentialSummary {
  schemaVersion: 1;
  username: string;
  password: string;
}

interface SafeStorageAdapter {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
  getSelectedStorageBackend?(): CredentialVaultStatus['backend'];
}

export type CredentialUseResult<T> =
  | { state: 'used'; value: T }
  | { state: 'not-found' }
  | { state: 'origin-mismatch' };

export class CredentialVaultUnavailableError extends Error {
  constructor(message = 'Secure credential storage is unavailable.') {
    super(message);
    this.name = 'CredentialVaultUnavailableError';
  }
}

export class CredentialVault {
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly path = join(app.getPath('userData'), 'agent-data', 'credentials.vault'),
    private readonly storage: SafeStorageAdapter = safeStorage,
  ) {}

  status(): CredentialVaultStatus {
    let backend: CredentialVaultStatus['backend'];
    try {
      backend = process.platform === 'linux' ? this.storage.getSelectedStorageBackend?.() : undefined;
    } catch {
      backend = undefined;
    }
    let encryptionAvailable = false;
    try {
      encryptionAvailable = this.storage.isEncryptionAvailable();
    } catch {
      encryptionAvailable = false;
    }
    if (!encryptionAvailable) {
      return { available: false, backend, reason: 'OS-backed credential encryption is unavailable.' };
    }
    const linuxSecureBackends: CredentialVaultStatus['backend'][] = ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'];
    if (process.platform === 'linux' && (!backend || !linuxSecureBackends.includes(backend))) {
      return { available: false, backend, reason: 'A Linux secret service or wallet is required.' };
    }
    return { available: true, backend };
  }

  list(): Promise<CredentialSummary[]> {
    return this.serialized(async () => {
      this.assertAvailable();
      const document = await this.readDocument();
      return document.entries.map((entry) => toSummary(this.decryptEntry(entry)));
    });
  }

  save(request: CredentialSaveRequest): Promise<CredentialSummary> {
    return this.serialized(async () => {
      this.assertAvailable();
      const safe = validateCredentialSaveRequest(request);
      const document = await this.readDocument();
      const existingIndex = safe.id
        ? document.entries.findIndex((entry) => entry.id === safe.id)
        : -1;
      if (safe.id && existingIndex < 0) throw new Error('Credential does not exist.');

      const now = new Date().toISOString();
      if (existingIndex < 0 && document.entries.length >= MAX_VAULT_ENTRIES) {
        throw new Error('Credential vault has reached its entry limit.');
      }
      const existing = existingIndex >= 0 ? this.decryptEntry(document.entries[existingIndex]!) : undefined;
      const decrypted: DecryptedCredentialEntry = {
        schemaVersion: 1,
        id: existing?.id ?? randomUUID(),
        label: safe.label,
        origin: safe.origin,
        username: safe.username,
        password: safe.password,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      const encrypted = this.encryptEntry(decrypted);
      if (existingIndex >= 0) document.entries[existingIndex] = encrypted;
      else document.entries.push(encrypted);
      await this.writeDocument(document);
      return toSummary(decrypted);
    });
  }

  remove(id: string): Promise<boolean> {
    return this.serialized(async () => {
      this.assertAvailable();
      const safeId = validateCredentialId(id);
      const document = await this.readDocument();
      const nextEntries = document.entries.filter((entry) => entry.id !== safeId);
      if (nextEntries.length === document.entries.length) return false;
      await this.writeDocument({ schemaVersion: 1, entries: nextEntries });
      return true;
    });
  }

  useForExactOrigin<T>(
    id: string,
    pageUrl: string,
    consumer: (username: string, password: string, origin: string) => Promise<T>,
  ): Promise<CredentialUseResult<T>> {
    return this.serialized(async () => {
      this.assertAvailable();
      const safeId = validateCredentialId(id);
      const document = await this.readDocument();
      const encrypted = document.entries.find((entry) => entry.id === safeId);
      if (!encrypted) return { state: 'not-found' };
      const credential = this.decryptEntry(encrypted);
      if (!credentialOriginMatches(credential.origin, pageUrl)) return { state: 'origin-mismatch' };
      const value = await consumer(credential.username, credential.password, credential.origin);
      return { state: 'used', value };
    });
  }

  private assertAvailable(): void {
    const status = this.status();
    if (!status.available) throw new CredentialVaultUnavailableError(status.reason);
  }

  private encryptEntry(entry: DecryptedCredentialEntry): EncryptedCredentialEntry {
    const ciphertext = this.storage.encryptString(JSON.stringify(entry)).toString('base64');
    return { id: entry.id, ciphertext };
  }

  private decryptEntry(entry: EncryptedCredentialEntry): DecryptedCredentialEntry {
    let parsed: unknown;
    try {
      parsed = JSON.parse(this.storage.decryptString(Buffer.from(entry.ciphertext, 'base64'))) as unknown;
    } catch {
      throw new Error('Credential vault is corrupted or cannot be decrypted.');
    }
    if (!isRecord(parsed) || parsed.schemaVersion !== 1 || parsed.id !== entry.id) {
      throw new Error('Credential vault contains an invalid entry.');
    }
    const request = validateCredentialSaveRequest({
      id: parsed.id,
      label: parsed.label,
      origin: parsed.origin,
      username: parsed.username,
      password: parsed.password,
    });
    if (!isIsoTimestamp(parsed.createdAt) || !isIsoTimestamp(parsed.updatedAt)) {
      throw new Error('Credential vault contains invalid timestamps.');
    }
    return {
      schemaVersion: 1,
      id: request.id!,
      label: request.label,
      origin: normalizeCredentialOrigin(request.origin),
      username: request.username,
      password: request.password,
      createdAt: parsed.createdAt,
      updatedAt: parsed.updatedAt,
    };
  }

  private async readDocument(): Promise<CredentialVaultDocument> {
    let input: string;
    try {
      input = await readFile(this.path, 'utf8');
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return { schemaVersion: 1, entries: [] };
      throw error;
    }

    if (input.length > MAX_VAULT_FILE_CHARACTERS) throw new Error('Credential vault file is too large.');
    let parsed: unknown;
    try {
      parsed = JSON.parse(input) as unknown;
    } catch {
      throw new Error('Credential vault file is corrupted.');
    }
    if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !Array.isArray(parsed.entries) || parsed.entries.length > MAX_VAULT_ENTRIES) {
      throw new Error('Credential vault file is invalid.');
    }
    const ids = new Set<string>();
    const entries = parsed.entries.map((value): EncryptedCredentialEntry => {
      if (!isRecord(value)) throw new Error('Credential vault contains an invalid entry.');
      const id = validateCredentialId(value.id);
      if (ids.has(id) || typeof value.ciphertext !== 'string' || !isCanonicalBase64(value.ciphertext)) {
        throw new Error('Credential vault contains an invalid entry.');
      }
      ids.add(id);
      return { id, ciphertext: value.ciphertext };
    });
    return { schemaVersion: 1, entries };
  }

  private async writeDocument(document: CredentialVaultDocument): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(document), { encoding: 'utf8', mode: 0o600 });
    await rename(temporaryPath, this.path);
    try {
      await chmod(this.path, 0o600);
    } catch {
      // Windows ACLs and some filesystems do not implement POSIX modes.
    }
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}

function toSummary(entry: DecryptedCredentialEntry): CredentialSummary {
  return {
    id: entry.id,
    label: entry.label,
    origin: entry.origin,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

function isCanonicalBase64(value: string): boolean {
  if (!value || value.length > 100_000 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  return Buffer.from(value, 'base64').toString('base64') === value;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && 'code' in value;
}
