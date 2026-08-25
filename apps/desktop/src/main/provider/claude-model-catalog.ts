import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

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
export async function readClaudeModelCatalog(executablePath: string, version = ''): Promise<CatalogModel[]> {
  for (const candidate of await catalogCandidates(executablePath, version)) {
    const models = await scanForModelIds(candidate);
    if (models.length) return models;
  }
  return [];
}

/**
 * The launcher on PATH is not always the executable that carries the ids. On macOS it is
 * a symlink the filesystem follows for us, but Windows needs Developer Mode for symlinks
 * so the installer leaves a small shim there instead. Scanning a shim yields nothing, so
 * the versioned build the CLI reports is tried next.
 */
async function catalogCandidates(executablePath: string, version: string): Promise<string[]> {
  const candidates = [executablePath];
  const build = /^\d+\.\d+\.\d+/.exec(version.trim())?.[0];
  if (!build) return candidates;

  // Prefer the layout relative to the launcher itself, so a system-wide or relocated
  // install resolves without assuming anything about the user's home directory.
  const roots = [
    join(dirname(executablePath), '..', 'share', 'claude', 'versions'),
    join(homedir(), '.local', 'share', 'claude', 'versions'),
  ];
  for (const root of roots) {
    for (const name of [build, `${build}.exe`]) {
      const candidate = join(root, name);
      try {
        if ((await stat(candidate)).isFile()) candidates.push(candidate);
      } catch {
        // This layout is only one of several installers; the others fall back cleanly.
      }
    }
  }
  return candidates;
}

async function scanForModelIds(executablePath: string): Promise<CatalogModel[]> {
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
