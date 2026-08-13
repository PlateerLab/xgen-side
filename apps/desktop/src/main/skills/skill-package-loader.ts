import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  BrowserActionCategory,
  ResolvedAgentMode,
  SkillCatalogEntry,
  SkillPermissionDescriptor,
  SkillRuntimeDescriptor,
  SkillRuntimeKind,
} from '../../shared/contracts';

interface SkillPackageManifest {
  schemaVersion: 1;
  id: string;
  settingKey: string;
  category: string;
  domain: string;
  enabledByDefault: boolean;
  activation: {
    role: 'primary' | 'supplemental' | 'guard';
    modes: ResolvedAgentMode[];
    intents: string[];
    signals: string[];
  };
  runtime: SkillRuntimeDescriptor;
  permissions: SkillPermissionDescriptor;
  presentation?: {
    browserVisible?: boolean;
  };
  progress: {
    label: string;
    detail: string;
  };
}

export interface LoadedSkillPackage extends SkillCatalogEntry {
  activation: SkillPackageManifest['activation'];
  browserVisible: boolean;
  browserActions: BrowserActionCategory[];
  instructions: string;
  resources: Array<{ path: string; content: string }>;
}

let cachedPackages: LoadedSkillPackage[] | undefined;

export function loadSkillPackages(): LoadedSkillPackage[] {
  if (cachedPackages) return cachedPackages;
  const root = resolveSkillRoot();
  const packages = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => loadSkillPackage(root, entry.name))
    .sort((left, right) => left.category.localeCompare(right.category) || left.name.localeCompare(right.name));
  assertUnique(packages.map((skill) => skill.id), 'skill id');
  assertUnique(packages.map((skill) => skill.settingKey), 'setting key');
  cachedPackages = packages;
  return packages;
}

export function listSkillCatalog(): SkillCatalogEntry[] {
  return loadSkillPackages().map(({ activation: _activation, browserVisible: _browserVisible, browserActions: _browserActions, instructions: _instructions, resources: _resources, ...skill }) => skill);
}

function loadSkillPackage(root: string, folderName: string): LoadedSkillPackage {
  const directory = join(root, folderName);
  const skillPath = join(directory, 'SKILL.md');
  const manifestPath = join(directory, 'manifest.json');
  if (!existsSync(skillPath) || !existsSync(manifestPath)) {
    throw new Error(`Skill package ${folderName} must contain SKILL.md and manifest.json.`);
  }
  const markdown = readFileSync(skillPath, 'utf8');
  const parsed = parseSkillMarkdown(markdown);
  if (parsed.name !== folderName) throw new Error(`Skill name ${parsed.name} must match folder ${folderName}.`);
  const manifest = parseManifest(readFileSync(manifestPath, 'utf8'), folderName);
  return {
    id: manifest.id,
    settingKey: manifest.settingKey,
    name: displayName(parsed.name),
    description: parsed.description,
    category: manifest.category,
    domain: manifest.domain,
    enabledByDefault: manifest.enabledByDefault,
    source: relative(root, skillPath).replaceAll('\\', '/'),
    markdown,
    runtime: manifest.runtime,
    permissions: manifest.permissions,
    progress: manifest.progress,
    activation: manifest.activation,
    browserVisible: manifest.presentation?.browserVisible === true,
    browserActions: manifest.permissions.allowActions.filter(isBrowserAction),
    instructions: parsed.body,
    resources: loadMarkdownResources(directory),
  };
}

function parseSkillMarkdown(markdown: string): { name: string; description: string; body: string } {
  const match = markdown.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n([\s\S]*)$/);
  if (!match) throw new Error('SKILL.md must begin with YAML frontmatter.');
  const frontmatter = match[1] ?? '';
  const fields = new Map<string, string>();
  for (const line of frontmatter.split(/\r?\n/)) {
    const field = line.match(/^([a-z][a-z0-9-]*):\s*(.+)$/);
    if (field?.[1] && field[2]) fields.set(field[1], unquote(field[2].trim()));
  }
  const name = fields.get('name') ?? '';
  const description = fields.get('description') ?? '';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64) throw new Error(`Invalid skill name: ${name}`);
  if (!description || description.length > 1_024) throw new Error(`Invalid skill description for ${name}.`);
  return { name, description, body: (match[2] ?? '').trim() };
}

function parseManifest(source: string, folderName: string): SkillPackageManifest {
  let value: unknown;
  try { value = JSON.parse(source); } catch { throw new Error(`Invalid manifest.json for ${folderName}.`); }
  if (!value || typeof value !== 'object') throw new Error(`Invalid manifest.json for ${folderName}.`);
  const manifest = value as SkillPackageManifest;
  if (manifest.schemaVersion !== 1 || !manifest.id || !manifest.settingKey || !manifest.category || !manifest.domain) {
    throw new Error(`Incomplete manifest.json for ${folderName}.`);
  }
  if (!manifest.activation?.modes?.length || !manifest.activation.role || !Array.isArray(manifest.activation.signals) || !manifest.runtime?.kind || !manifest.runtime.capability || !Array.isArray(manifest.runtime.tools)) {
    throw new Error(`Invalid runtime or activation in ${folderName}/manifest.json.`);
  }
  if (!isRuntimeKind(manifest.runtime.kind) || !manifest.permissions?.risk || !manifest.progress?.label) {
    throw new Error(`Invalid permissions or progress metadata in ${folderName}/manifest.json.`);
  }
  if (manifest.runtime.kind === 'agent-browser') {
    const invalidActions = manifest.permissions.allowActions.filter((action) => !isBrowserAction(action));
    const invalidTools = manifest.runtime.tools.filter((tool) => !agentBrowserTools.has(tool));
    const invalidProfiles = (manifest.runtime.toolProfiles ?? []).filter((profile) => !agentBrowserProfiles.has(profile));
    if (invalidActions.length || invalidTools.length || invalidProfiles.length) {
      throw new Error(`Invalid agent-browser contract in ${folderName}/manifest.json: ${[...invalidActions, ...invalidTools, ...invalidProfiles].join(', ')}`);
    }
  }
  return manifest;
}

function loadMarkdownResources(directory: string): Array<{ path: string; content: string }> {
  const references = join(directory, 'references');
  if (!existsSync(references)) return [];
  return readdirSync(references, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => ({ path: `references/${entry.name}`, content: readFileSync(join(references, entry.name), 'utf8').trim() }));
}

function resolveSkillRoot(): string {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.XGEN_SIDE_SKILLS_DIR,
    join(process.cwd(), 'skills'),
    join(process.cwd(), 'apps', 'desktop', 'skills'),
    join(moduleDirectory, '..', '..', '..', 'skills'),
    join(moduleDirectory, '..', '..', 'skills'),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const root = candidates.find((candidate) => existsSync(candidate) && existsSync(join(candidate, 'xgen-conversation', 'SKILL.md')));
  if (!root) throw new Error('XGEN Side skill packages were not found. Set XGEN_SIDE_SKILLS_DIR to their directory.');
  return root;
}

function displayName(name: string): string {
  return name.replace(/^xgen-/, '').split('-').map((word) => word[0]?.toUpperCase() + word.slice(1)).join(' ');
}

function unquote(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) return value.slice(1, -1);
  return value;
}

function isRuntimeKind(value: string): value is SkillRuntimeKind {
  return ['llm', 'provider-web', 'page-context', 'agent-browser', 'policy'].includes(value);
}

function isBrowserAction(value: string): value is BrowserActionCategory {
  return ['navigate', 'click', 'fill', 'eval', 'download', 'upload', 'snapshot', 'scroll', 'wait', 'read', 'get', 'interact', 'network', 'state'].includes(value);
}

const agentBrowserProfiles = new Set(['core', 'network', 'state', 'debug', 'files', 'tabs', 'react', 'mobile', 'all']);
const agentBrowserTools = new Set([
  'agent_browser_open', 'agent_browser_read', 'agent_browser_snapshot', 'agent_browser_click',
  'agent_browser_fill', 'agent_browser_type', 'agent_browser_press', 'agent_browser_check',
  'agent_browser_upload', 'agent_browser_download',
  'agent_browser_uncheck', 'agent_browser_select', 'agent_browser_scroll',
  'agent_browser_wait_ms', 'agent_browser_wait_for_selector', 'agent_browser_wait_for_text',
  'agent_browser_wait_for_load', 'agent_browser_screenshot', 'agent_browser_get_text',
  'agent_browser_get_url', 'agent_browser_get_title', 'agent_browser_close', 'agent_browser_back',
  'agent_browser_forward', 'agent_browser_reload', 'agent_browser_tab_new', 'agent_browser_tab_list',
  'agent_browser_tab_switch', 'agent_browser_tab_close', 'agent_browser_window_new',
  'agent_browser_frame_switch', 'agent_browser_frame_main', 'agent_browser_dialog_status',
  'agent_browser_dialog_accept', 'agent_browser_dialog_dismiss',
]);

function assertUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label} in XGEN Side skill packages.`);
}
