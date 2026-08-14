import type { App } from 'electron';
import type { DesktopPlatform } from './platform-runtime';

export interface PlatformPasskeyStatus {
  available: boolean;
  method: 'touch-id' | 'windows-hello' | 'external-only';
  reason?: string;
}

const keychainAccessGroupPattern = /^[A-Z0-9]{10}\.[A-Za-z0-9.-]+\.webauthn$/;

export function platformPasskeyStatus(
  platform: DesktopPlatform,
  keychainAccessGroup = process.env.XGEN_SIDE_WEBAUTHN_KEYCHAIN_ACCESS_GROUP,
): PlatformPasskeyStatus {
  if (platform === 'win32') return { available: true, method: 'windows-hello' };
  if (!keychainAccessGroup || !keychainAccessGroupPattern.test(keychainAccessGroup)) {
    return {
      available: false,
      method: 'external-only',
      reason: 'Touch ID requires the signed macOS build WebAuthn keychain access group.',
    };
  }
  return { available: true, method: 'touch-id' };
}

export function configurePlatformWebAuthn(app: Pick<App, 'configureWebAuthn'>, platform: DesktopPlatform): PlatformPasskeyStatus {
  const status = platformPasskeyStatus(platform);
  if (platform === 'darwin' && status.available) {
    app.configureWebAuthn({
      touchID: {
        keychainAccessGroup: process.env.XGEN_SIDE_WEBAUTHN_KEYCHAIN_ACCESS_GROUP!,
        promptReason: 'sign in to $1',
      },
    });
  }
  return status;
}

export function passkeyAgentInstruction(status: PlatformPasskeyStatus): string {
  if (status.method === 'touch-id') return 'Native passkey is enabled through macOS Touch ID. Click the site passkey control once, then stop and wait for direct user verification.';
  if (status.method === 'windows-hello') return 'Native passkey is enabled through Windows Hello. Click the site passkey control once, then stop and wait for direct user verification.';
  return `A local platform passkey is not available: ${status.reason} Use the site's external-device, QR, or security-key path when offered, or use the approved XGEN vault login path.`;
}
