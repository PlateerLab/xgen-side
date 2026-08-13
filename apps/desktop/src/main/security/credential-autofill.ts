import type { WebContents } from 'electron';
import type { CredentialAutofillResult } from '../../shared/contracts';
import { CredentialVault, CredentialVaultUnavailableError } from '../storage/credential-vault';
import { credentialOriginMatches, validateCredentialId } from './credential-policy';

export interface CredentialAutofillTarget {
  contents: WebContents;
  protect(): void;
}

export type CredentialAutofillTargetResolver = (tabId: string) => CredentialAutofillTarget | undefined;

export class CredentialAutofillService {
  constructor(
    private readonly vault: CredentialVault,
    private readonly resolveTarget: CredentialAutofillTargetResolver,
  ) {}

  async fill(credentialId: string, tabId: string): Promise<CredentialAutofillResult> {
    validateCredentialId(credentialId);
    if (typeof tabId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tabId)) {
      throw new Error('Invalid browser tab id.');
    }
    if (!this.vault.status().available) return { state: 'unavailable' };
    const target = this.resolveTarget(tabId);
    if (!target || target.contents.isDestroyed()) return { state: 'unavailable' };
    // Protection is intentionally permanent for the tab and begins before any secret is decrypted.
    target.protect();
    const contents = target.contents;
    const pageUrl = contents.getURL();

    try {
      const result = await this.vault.useForExactOrigin(
        credentialId,
        pageUrl,
        (username, password, origin) => this.insertIntoPage(contents, origin, username, password),
      );
      if (result.state !== 'used') return { state: result.state };
      return result.value;
    } catch (error) {
      if (error instanceof CredentialVaultUnavailableError) return { state: 'unavailable' };
      throw error;
    }
  }

  private async insertIntoPage(
    contents: WebContents,
    origin: string,
    username: string,
    password: string,
  ): Promise<CredentialAutofillResult> {
    if (!isCurrentExactOrigin(contents, origin)) return { state: 'origin-mismatch' };

    const preventNavigation = (event: { preventDefault(): void }): void => event.preventDefault();
    contents.on('will-navigate', preventNavigation);
    contents.on('will-redirect', preventNavigation);
    try {
      const hasPassword = await focusCredentialField(contents, origin, 'password');
      if (!hasPassword || !isCurrentExactOrigin(contents, origin)) return { state: 'no-password-field' };

      const hasUsername = await focusCredentialField(contents, origin, 'username');
      let usernameFilled = false;
      if (hasUsername && isCurrentExactOrigin(contents, origin)) {
        await contents.insertText(username);
        usernameFilled = true;
      }

      const passwordFocused = await focusCredentialField(contents, origin, 'password');
      if (!passwordFocused || !isCurrentExactOrigin(contents, origin)) return { state: 'no-password-field' };
      await contents.insertText(password);
      return { state: 'filled', usernameFilled };
    } finally {
      contents.removeListener('will-navigate', preventNavigation);
      contents.removeListener('will-redirect', preventNavigation);
    }
  }
}

function isCurrentExactOrigin(contents: WebContents, expectedOrigin: string): boolean {
  return !contents.isDestroyed() && credentialOriginMatches(expectedOrigin, contents.getURL());
}

async function focusCredentialField(
  contents: WebContents,
  expectedOrigin: string,
  kind: 'username' | 'password',
): Promise<boolean> {
  const script = buildFocusScript(expectedOrigin, kind);
  try {
    return await contents.executeJavaScript(script, true) === true;
  } catch {
    return false;
  }
}

function buildFocusScript(expectedOrigin: string, kind: 'username' | 'password'): string {
  return `(() => {
    if (location.origin !== ${JSON.stringify(expectedOrigin)}) return false;
    const usable = (input) => {
      if (!(input instanceof HTMLInputElement) || input.disabled || input.readOnly) return false;
      const style = getComputedStyle(input);
      return style.display !== 'none' && style.visibility !== 'hidden' && input.getClientRects().length > 0;
    };
    const passwords = Array.from(document.querySelectorAll('input[type="password"]')).filter(usable);
    const password = passwords.find((input) => (input.getAttribute('autocomplete') || '').toLowerCase() === 'current-password')
      || passwords.find((input) => (input.getAttribute('autocomplete') || '').toLowerCase() !== 'new-password');
    if (!password) return false;
    let target = password;
    if (${JSON.stringify(kind)} === 'username') {
      const scope = password.form || document;
      const candidates = Array.from(scope.querySelectorAll('input')).filter((input) => {
        if (!usable(input) || input === password) return false;
        const type = (input.getAttribute('type') || 'text').toLowerCase();
        const autocomplete = (input.getAttribute('autocomplete') || '').toLowerCase();
        return autocomplete === 'username' || type === 'email' || type === 'text';
      });
      const preceding = candidates.filter((input) => Boolean(input.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING));
      target = candidates.find((input) => (input.getAttribute('autocomplete') || '').toLowerCase() === 'username')
        || candidates.find((input) => (input.getAttribute('type') || '').toLowerCase() === 'email')
        || [...preceding].reverse().find((input) => /(?:user|email|login|account)/i.test(input.name + ' ' + input.id))
        || preceding.at(-1);
      if (!target) return false;
    }
    target.focus({ preventScroll: true });
    target.select();
    return document.activeElement === target;
  })()`;
}
