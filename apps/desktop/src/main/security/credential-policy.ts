import type { CredentialSaveRequest } from '../../shared/contracts';

const CREDENTIAL_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ORIGIN_LENGTH = 2_048;
const MAX_LABEL_LENGTH = 100;
const MAX_USERNAME_LENGTH = 320;
const MAX_PASSWORD_LENGTH = 16_384;

export interface ValidatedCredentialSaveRequest {
  id?: string;
  label: string;
  origin: string;
  username: string;
  password: string;
}

export function normalizeCredentialOrigin(value: string): string {
  if (typeof value !== 'string' || !value || value.length > MAX_ORIGIN_LENGTH) {
    throw new Error('Credential origin must be a valid HTTPS URL.');
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Credential origin must be a valid HTTPS URL.');
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.origin === 'null') {
    throw new Error('Credential origin must use HTTPS.');
  }
  const isLoopbackHttp = url.protocol === 'http:'
    && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]');
  if (url.protocol !== 'https:' && !isLoopbackHttp) {
    throw new Error('Credential origin must use HTTPS unless it is a loopback host.');
  }
  if (url.username || url.password) {
    throw new Error('Credential origin must not contain embedded credentials.');
  }
  return url.origin;
}

export function credentialOriginMatches(storedOrigin: string, pageUrl: string): boolean {
  try {
    return normalizeCredentialOrigin(storedOrigin) === normalizeCredentialOrigin(pageUrl);
  } catch {
    return false;
  }
}

export function validateCredentialId(value: unknown): string {
  if (typeof value !== 'string' || !CREDENTIAL_ID_PATTERN.test(value)) {
    throw new Error('Invalid credential id.');
  }
  return value;
}

export function validateCredentialSaveRequest(value: unknown): ValidatedCredentialSaveRequest {
  if (!isRecord(value)) throw new Error('Invalid credential request.');
  const id = value.id === undefined ? undefined : validateCredentialId(value.id);
  const label = validateText(value.label, 'Credential label', 1, MAX_LABEL_LENGTH).trim();
  if (!label || /[\u0000-\u001f\u007f]/.test(label)) {
    throw new Error('Credential label contains unsupported characters.');
  }
  const origin = normalizeCredentialOrigin(validateText(value.origin, 'Credential origin', 1, MAX_ORIGIN_LENGTH));
  const username = validateText(value.username, 'Credential username', 1, MAX_USERNAME_LENGTH);
  const password = validateText(value.password, 'Credential password', 1, MAX_PASSWORD_LENGTH);
  return { id, label, origin, username, password } satisfies CredentialSaveRequest;
}

function validateText(value: unknown, label: string, minimum: number, maximum: number): string {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum) {
    throw new Error(`${label} must contain between ${minimum} and ${maximum} characters.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
