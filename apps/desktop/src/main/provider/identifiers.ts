/**
 * Identifier shapes accepted from the renderer. Both are anchored allowlists rather than
 * denylists, because these values are passed straight through to provider CLI arguments.
 */

/** Skill ids are ours, so they stay conservative. */
export const skillIdPattern = /^[A-Za-z0-9._:-]{1,100}$/;

/**
 * Model ids additionally allow the bracketed context-window suffix the Claude CLI uses,
 * for example `claude-fable-5[1m]`. Brackets are inert here because every provider
 * process is spawned with `shell: false`, so no shell ever interprets them.
 */
export const modelIdPattern = /^[A-Za-z0-9._:[\]-]{1,100}$/;
