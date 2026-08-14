import type { CommandRequest, PolicyDecision } from '../../shared/contracts';

export interface PolicyEvaluation {
  decision: PolicyDecision;
  reason: string;
}

const deniedPatterns: ReadonlyArray<RegExp> = [
  /\bformat(?:-volume)?\b/i,
  /\bdiskpart\b/i,
  /\bbcdedit\b/i,
  /\bshutdown(?:\.exe)?\b/i,
  /\bstop-computer\b/i,
  /\bremove-item\b[^\r\n]*(?:-recurse|-force)/i,
  /\brd\b[^\r\n]*\/s\b/i,
  /\bdel\b[^\r\n]*\/s\b/i,
  /\breg(?:\.exe)?\s+delete\b/i,
  /(?:^|\s)rm\s+[^\r\n]*(?:-rf|-fr|--recursive[^\r\n]*--force|--force[^\r\n]*--recursive)(?:\s|$)/i,
];

const approvalPatterns: ReadonlyArray<RegExp> = [
  /\bgit\s+(?:push|commit|merge|rebase|reset|clean)\b/i,
  /\b(?:npm|pnpm|yarn)\s+(?:publish|install|add|remove|update)\b/i,
  /\bdocker\s+(?:rm|rmi|prune|compose\s+down)\b/i,
  /\b(?:new-item|set-content|add-content|copy-item|move-item|remove-item)\b/i,
  /(?:^|\s)(?:>|>>)(?:\s|$)/,
  /\binvoke-webrequest\b/i,
  /\bcurl(?:\.exe)?\b/i,
  /(?:^|\s)(?:cp|mv|mkdir|touch|chmod|chown|rm)(?:\s|$)/i,
];

const allowedPatterns: ReadonlyArray<RegExp> = [
  /^\s*(?:get-childitem|gci|dir)(?:\s|$)/i,
  /^\s*(?:get-content|gc|type)(?:\s|$)/i,
  /^\s*(?:get-location|pwd)(?:\s|$)/i,
  /^\s*git\s+(?:status|diff|log|show|branch)(?:\s|$)/i,
  /^\s*(?:node|python|python3|cargo|rustc|pnpm)\s+--?version\s*$/i,
  /^\s*(?:echo|write-output)\b/i,
  /^\s*(?:whoami|hostname)\s*$/i,
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
