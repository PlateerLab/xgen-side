import type { AgentPermissionMode, AgentRunRequest, RoutedSkill } from '../../shared/contracts';

/**
 * Choosing a mode by hand is the user's consent to what that mode can do. Auto routing
 * carries no such signal, so when it escalates a request into skills that can change
 * remote state on their own, the run is capped at Guard: navigation and inspection still
 * run freely, and each mutating action goes through the approval broker.
 *
 * Returns the explanation when a cap applies, so the same string can be shown in the run
 * overview and recorded in the run store. Read-only routes are never capped, and a
 * ceiling the user already set lower is left alone -- this only ever lowers.
 */
export function cappedPermissionReason(
  request: Pick<AgentRunRequest, 'mode' | 'permissionMode'>,
  skills: RoutedSkill[],
): string | undefined {
  if (request.mode !== 'auto' || (request.permissionMode ?? 'guard') !== 'full-access') return undefined;
  const mutating = skills.filter((skill) => skill.risk !== 'read');
  if (!mutating.length) return undefined;
  return `Auto 라우팅이 ${mutating.map((skill) => skill.name).join(', ')}을(를) 선택했기 때문에 이번 실행은 Guard로 제한했습니다. Full access로 실행하려면 실행 범위를 직접 선택해 주세요.`;
}

/** The ceiling actually applied to a run. Never raises what the user chose. */
export function effectivePermissionMode(
  request: Pick<AgentRunRequest, 'permissionMode'>,
  capped: boolean,
): AgentPermissionMode {
  const chosen = request.permissionMode ?? 'guard';
  return capped ? 'guard' : chosen;
}
