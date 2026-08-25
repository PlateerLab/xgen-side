import type { AgentPermissionMode, AgentRunRequest, RoutedSkill } from '../../shared/contracts';

/** Ordered narrowest to widest. A run may only ever be moved down this list. */
const permissionRank: Record<AgentPermissionMode, number> = {
  'read-only': 0,
  guard: 1,
  'full-access': 2,
};

/**
 * Choosing a mode by hand is the user's consent to what that mode can do. Auto routing
 * carries no such signal, so when it escalates a request into skills that can change
 * remote state on their own, the run is capped at Guard: navigation and inspection still
 * run freely, and each mutating action goes through the approval broker.
 *
 * Returns the explanation when a cap applies, so the same string can be shown in the run
 * overview and recorded in the run store.
 */
export function cappedPermissionReason(
  request: Pick<AgentRunRequest, 'mode' | 'permissionMode'>,
  skills: RoutedSkill[],
): string | undefined {
  if (request.mode !== 'auto') return undefined;
  if (permissionRank[request.permissionMode ?? 'guard'] <= permissionRank.guard) return undefined;

  const mutating = skills.filter((skill) => skill.risk !== 'read');
  if (!mutating.length) return undefined;
  return `Auto 라우팅이 ${mutating.map((skill) => skill.name).join(', ')}을(를) 선택했기 때문에 이번 실행은 Guard로 제한했습니다. Full access로 실행하려면 실행 범위를 직접 선택해 주세요.`;
}

/**
 * The ceiling actually applied to a run. Takes the narrower of the user's choice and the
 * cap, so this can only ever lower a run's permissions -- never raise them, whatever a
 * future caller passes.
 */
export function effectivePermissionMode(
  request: Pick<AgentRunRequest, 'permissionMode'>,
  capped: boolean,
): AgentPermissionMode {
  const chosen = request.permissionMode ?? 'guard';
  if (!capped) return chosen;
  return permissionRank[chosen] <= permissionRank.guard ? chosen : 'guard';
}
