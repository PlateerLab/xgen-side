import type { CommandRequest, PolicyDecision } from '../../shared/contracts';

export interface PolicyEvaluation {
  decision: PolicyDecision;
  reason: string;
}

// Patterns are matched against every request regardless of the requested shell.
// A PowerShell request can still invoke a native POSIX binary (and pwsh aliases
// `rm` to Remove-Item), so shell-gating the deny list would only create holes.
// The union is never weaker than either platform's list on its own.

const deniedWindowsPatterns: ReadonlyArray<RegExp> = [
  /\bformat(?:-volume)?\b/i,
  /\bdiskpart\b/i,
  /\bbcdedit\b/i,
  /\bshutdown(?:\.exe)?\b/i,
  /\bstop-computer\b/i,
  /\bremove-item\b[^\r\n]*(?:-recurse|-force)/i,
  /\brd\b[^\r\n]*\/s\b/i,
  /\bdel\b[^\r\n]*\/s\b/i,
  /\breg(?:\.exe)?\s+delete\b/i,
];

const deniedPosixPatterns: ReadonlyArray<RegExp> = [
  // `rm` carrying a recursive or force flag, in any spelling: -rf, -fr, -r -f,
  // --recursive, --force. Mirrors the Windows `remove-item -recurse|-force` rule,
  // which also denies force without recurse. Bare `rm file` stays an approval.
  /\brm\b[^\r\n]*?\s-{1,2}[a-z-]*(?:r|f)[a-z-]*\b/i,
  /\b(?:sudo|doas)\b/i,
  /\bmkfs(?:\.\w+)?\b/i,
  /\bdd\b[^\r\n]*\b(?:if|of)=/i,
  /\bdiskutil\b[^\r\n]*\b(?:erase\w*|reformat|partitiondisk)\b/i,
  /\b(?:reboot|poweroff|halt|init\s+0)\b/i,
  /\bchmod\b[^\r\n]*\b777\b/i,
  />\s*\/dev\/(?:disk|sd|nvme|hd)/i,
  // Fork bomb, e.g. :(){ :|:& };:
  /:\s*\(\s*\)\s*\{[^}]*\}\s*;\s*:/,
];

const deniedCrossPlatformPatterns: ReadonlyArray<RegExp> = [
  // Piping a download straight into an interpreter is remote code execution.
  // A one-time approval is too weak a gate for it on any platform.
  /\b(?:curl|wget)\b[^\r\n]*\|\s*(?:sudo\s+)?(?:ba|z|k|da)?sh\b/i,
];

const deniedPatterns: ReadonlyArray<RegExp> = [
  ...deniedWindowsPatterns,
  ...deniedPosixPatterns,
  ...deniedCrossPlatformPatterns,
];

const approvalPatterns: ReadonlyArray<RegExp> = [
  /\bgit\s+(?:push|commit|merge|rebase|reset|clean)\b/i,
  /\b(?:npm|pnpm|yarn)\s+(?:publish|install|add|remove|update)\b/i,
  /\bdocker\s+(?:rm|rmi|prune|compose\s+down)\b/i,
  /\b(?:new-item|set-content|add-content|copy-item|move-item|remove-item)\b/i,
  // Output redirection is a file write whether or not a space follows the arrow.
  /(?:^|\s)>{1,2}/,
  /\binvoke-webrequest\b/i,
  /\bcurl(?:\.exe)?\b/i,
  // POSIX counterparts of the mutating cmdlets above.
  /^\s*(?:rm|mv|cp|mkdir|touch|ln|chmod|chown|kill|killall)\b/i,
  /\bwget\b/i,
];

const allowedPatterns: ReadonlyArray<RegExp> = [
  /^\s*(?:get-childitem|gci|dir)(?:\s|$)/i,
  /^\s*(?:get-content|gc|type)(?:\s|$)/i,
  /^\s*(?:get-location|pwd)(?:\s|$)/i,
  /^\s*git\s+(?:status|diff|log|show|branch)(?:\s|$)/i,
  /^\s*(?:node|python|python3|cargo|rustc|pnpm)\s+--?version\s*$/i,
  /^\s*(?:echo|write-output)\b/i,
  /^\s*(?:whoami|hostname)\s*$/i,
  // POSIX read-only baseline. `ls` and `cat` are also PowerShell aliases for the
  // read-only cmdlets above, so allowing them does not widen Windows.
  /^\s*(?:ls|cat|uname|id|date)(?:\s|$)/i,
  /^\s*(?:which|command\s+-v)(?:\s|$)/i,
];

export class PolicyEngine {
  evaluateCommand(request: CommandRequest): PolicyEvaluation {
    const script = request.script.trim();

    if (!script) {
      return { decision: 'deny', reason: 'Empty commands are not executable.' };
    }

    if (deniedPatterns.some((pattern) => pattern.test(script))) {
      return {
        decision: 'deny',
        reason: 'The command matches a destructive operation blocked by the XGEN Side baseline policy.',
      };
    }

    if (script.includes('\n') || script.includes('\r')) {
      return {
        decision: 'ask',
        reason: 'Multi-line scripts require one-time approval.',
      };
    }

    if (approvalPatterns.some((pattern) => pattern.test(script))) {
      return {
        decision: 'ask',
        reason: 'The command can modify files, dependencies, repositories, containers, or the network.',
      };
    }

    if (allowedPatterns.some((pattern) => pattern.test(script))) {
      return {
        decision: 'allow',
        reason: 'The command matches the read-only baseline policy.',
      };
    }

    return {
      decision: 'ask',
      reason: 'Unknown commands require one-time approval in Guard mode.',
    };
  }
}
