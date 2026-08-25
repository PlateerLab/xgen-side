import { createReadStream } from 'node:fs';

/** Ids the CLI accepts, e.g. claude-opus-4-6. Dated snapshots and build variants are excluded. */
const modelIdInBinary = /claude-(opus|sonnet|haiku|fable)-(\d{1,2})(?:-(\d{1,2}))?(?![\d-])/g;

/** Newest and most capable first, matching how the CLI presents its own aliases. */
const familyOrder = ['fable', 'opus', 'sonnet', 'haiku'];

export interface CatalogModel {
  id: string;
  label: string;
  family: string;
  major: number;
  minor?: number;
}

/**
 * Reads the model ids the installed Claude Code CLI actually knows about.
 *
 * The CLI exposes no command that enumerates models, and its account cache only carries
 * the one or two models gated to the signed-in plan, so the shipped executable is the
 * only complete source available offline. It is scanned in chunks because that file is
 * hundreds of megabytes and must not be held in memory as one string.
 *
 * Returns an empty list on any failure so callers fall back to the documented aliases.
 */
export async function readClaudeModelCatalog(executablePath: string): Promise<CatalogModel[]> {
  const found = new Map<string, CatalogModel>();
  try {
    const stream = createReadStream(executablePath, { encoding: 'latin1', highWaterMark: 4 * 1024 * 1024 });
    // Ids can straddle a chunk boundary, so the tail of each chunk is prepended to the next.
    let carry = '';
    for await (const chunk of stream) {
      const text = carry + (chunk as string);
      for (const match of text.matchAll(modelIdInBinary)) {
        const [id, family, major, minor] = match;
        if (!family || !major) continue;
        found.set(id, {
          id,
          family,
          major: Number(major),
          minor: minor === undefined ? undefined : Number(minor),
          label: `Claude ${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}${minor === undefined ? '' : `.${minor}`}`,
        });
      }
      carry = text.slice(-64);
    }
  } catch {
    return [];
  }

  // A bare major is the CLI's own alias for its newest minor, so drop it when the
  // concrete versions it stands for are already listed.
  const hasMinor = new Set([...found.values()].filter((m) => m.minor !== undefined).map((m) => `${m.family}-${m.major}`));
  return [...found.values()]
    .filter((model) => model.minor !== undefined || !hasMinor.has(`${model.family}-${model.major}`))
    .sort((a, b) => {
      const family = familyOrder.indexOf(a.family) - familyOrder.indexOf(b.family);
      if (family !== 0) return family;
      if (a.major !== b.major) return b.major - a.major;
      return (b.minor ?? -1) - (a.minor ?? -1);
    });
}
