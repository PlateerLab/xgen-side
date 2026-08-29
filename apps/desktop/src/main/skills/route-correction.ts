import type { ResolvedAgentMode, RouteCorrection } from '../../shared/contracts';

const resolvedModes: ReadonlyArray<ResolvedAgentMode> = ['chat', 'search', 'page', 'browser-agent'];

/** Session ids are UUIDs the main process generated; anything else is not one. */
const sessionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A correction arrives from the renderer, so it is validated rather than trusted.
 * It only ever annotates a run, so an unusable value is dropped instead of
 * failing the run the user asked for.
 */
export function sanitizeRouteCorrection(value: unknown): RouteCorrection | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<RouteCorrection>;
  if (!resolvedModes.includes(candidate.routedMode as ResolvedAgentMode)) return undefined;
  const sessionId = typeof candidate.sessionId === 'string' && sessionIdPattern.test(candidate.sessionId)
    ? candidate.sessionId
    : undefined;
  return { routedMode: candidate.routedMode as ResolvedAgentMode, sessionId };
}
