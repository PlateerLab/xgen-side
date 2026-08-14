import { randomUUID } from 'node:crypto';
import type {
  AgentRunRequest,
  BrowserActionCategory,
  ResolvedAgentMode,
  RoutedSkill,
  SkillCatalogEntry,
  SkillRoute,
  SkillRouteStep,
} from '../../shared/contracts';
import { LocalSettingsStore } from '../storage/local-settings-store';
import { listSkillCatalog, loadSkillPackages, type LoadedSkillPackage } from './skill-package-loader';

export class SkillRouter {
  private readonly packages: LoadedSkillPackage[];

  constructor(
    private readonly settingsStore: LocalSettingsStore,
    packages: LoadedSkillPackage[] = loadSkillPackages(),
  ) {
    this.packages = packages;
  }

  list(): SkillCatalogEntry[] {
    return listSkillCatalog();
  }

  instructionsFor(route: SkillRoute): string {
    const selected = new Set(route.skills.map((skill) => skill.id));
    return this.packages
      .filter((skill) => selected.has(skill.id))
      .map((skill) => {
        const resources = skill.resources.map((resource) => `<skill_resource path="${resource.path}">\n${resource.content}\n</skill_resource>`).join('\n\n');
        return `<skill name="${skill.id}">\n${skill.instructions}${resources ? `\n\n${resources}` : ''}\n</skill>`;
      })
      .join('\n\n');
  }

  async route(request: AgentRunRequest): Promise<SkillRoute> {
    const settings = await this.settingsStore.load();
    const resolvedMode = resolveMode(request, this.packages);
    const targetUrl = request.pageContext?.url || extractUrl(request.prompt);
    const targetHost = hostFromUrl(targetUrl);
    const selectedIds = uniqueIds(request.selectedSkillIds ?? []);
    const unknownSelectedIds = selectedIds.filter((id) => !this.packages.some((skill) => skill.id === id));
    const attachmentSignals = request.attachments?.map((attachment) => `${attachment.name} ${attachment.kind}`).join(' ') ?? '';
    const requested = selectPackages(this.packages, resolvedMode, `${request.prompt} ${attachmentSignals}`, selectedIds);
    const skills = requested.filter((skill) => settings.skillEnabled[skill.settingKey] ?? skill.enabledByDefault);
    const disabledSelectedIds = selectedIds.filter((id) => requested.some((skill) => skill.id === id) && !skills.some((skill) => skill.id === id));
    const incompatibleSelectedIds = selectedIds.filter((id) => !requested.some((skill) => skill.id === id));
    const missingPrimary = requested.some((skill) => skill.activation.role === 'primary')
      && !skills.some((skill) => skill.activation.role === 'primary');
    const agentBrowserRequested = requested.some((skill) => skill.runtime.kind === 'agent-browser') && resolvedMode === 'browser-agent';
    const agentBrowserRequired = skills.some((skill) => skill.runtime.kind === 'agent-browser') && resolvedMode === 'browser-agent';
    const browserVisible = agentBrowserRequired
      || (resolvedMode === 'search' && skills.some((skill) => skill.browserVisible));
    const blockedReason = unknownSelectedIds.length
      ? `Unknown selected Skill: ${unknownSelectedIds.join(', ')}`
      : incompatibleSelectedIds.length
        ? `The selected Skill cannot run in ${resolvedMode} mode: ${incompatibleSelectedIds.join(', ')}`
        : disabledSelectedIds.length
          ? `The selected Skill is disabled in Settings: ${disabledSelectedIds.join(', ')}`
          : missingPrimary
            ? 'This request requires a Skill that is disabled in Settings.'
            : agentBrowserRequested && !agentBrowserRequired
              ? 'The browser-control Skills required for this request are disabled in Settings.'
              : undefined;
    const browserActionCategories = agentBrowserRequired
      ? uniqueActions(skills.flatMap((skill) => skill.browserActions))
      : [];

    return {
      id: randomUUID(),
      resolvedMode,
      reason: routeReason(skills, targetHost, resolvedMode),
      browserVisible,
      agentBrowserRequired,
      targetUrl,
      targetHost: targetHost || undefined,
      browserActionCategories,
      skills: skills.map(toRoutedSkill),
      steps: buildSteps(skills, targetHost, resolvedMode, agentBrowserRequired),
      blockedReason,
    };
  }
}

export function resolveMode(
  request: AgentRunRequest,
  packages: LoadedSkillPackage[] = loadSkillPackages(),
): ResolvedAgentMode {
  if (request.mode !== 'auto') return request.mode;
  if (request.attachments?.length) return 'chat';
  const selected = packages.filter((skill) => request.selectedSkillIds?.includes(skill.id));
  if (selected.some((skill) => skill.runtime.kind === 'agent-browser')) return 'browser-agent';
  if (selected.some((skill) => skill.runtime.kind === 'provider-web')) return 'search';
  if (request.pageContext && selected.some((skill) => skill.runtime.kind === 'page-context')) return 'page';
  if (selected.some((skill) => skill.runtime.kind === 'llm')) return 'chat';

  const conversation = packages.find((skill) => skill.id === 'xgen.conversation');
  if (conversation && matchesSignals(request.prompt, conversation.activation.signals)) return 'chat';

  const browserSignals = packages
    .filter((skill) => skill.activation.modes.includes('browser-agent') && skill.activation.role !== 'supplemental')
    .flatMap((skill) => skill.activation.signals);
  if (matchesSignals(request.prompt, browserSignals)) return 'browser-agent';

  const research = packages.find((skill) => skill.id === 'xgen.web-research');
  if (research && matchesSignals(request.prompt, research.activation.signals)) return 'search';

  if (request.pageContext) return 'page';
  return 'chat';
}

function selectPackages(
  packages: LoadedSkillPackage[],
  mode: ResolvedAgentMode,
  prompt: string,
  selectedIds: string[] = [],
): LoadedSkillPackage[] {
  const selected = new Set(selectedIds);
  return packages.filter((skill) => {
    if (!skill.activation.modes.includes(mode)) return false;
    if (selected.has(skill.id)) return true;
    if (skill.activation.role === 'primary') return true;
    return matchesSignals(prompt, skill.activation.signals);
  });
}

function matchesSignals(prompt: string, signals: string[]): boolean {
  const normalized = prompt.toLocaleLowerCase();
  return signals.some((signal) => {
    const candidate = signal.toLocaleLowerCase();
    if (/^[a-z0-9 ]+$/.test(candidate)) {
      const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll(' ', '\\s+');
      return new RegExp(`(?:^|\\b)${escaped}(?:$|\\b)`, 'i').test(normalized);
    }
    return normalized.includes(candidate);
  });
}

function buildSteps(
  skills: LoadedSkillPackage[],
  host: string,
  _mode: ResolvedAgentMode,
  _agentBrowserRequired: boolean,
): SkillRouteStep[] {
  const login = skills.some((skill) => skill.id === 'xgen.login-assistant');
  if (login) {
    return [
      { id: 'auth-tabs', label: '현재 열린 탭 확인', detail: '기존 네이버 탭과 로그인 세션을 먼저 확인합니다', kind: 'browser' },
      { id: 'auth-page', label: '네이버 로그인 준비', detail: '공식 로그인 페이지를 열고 새 snapshot으로 상태를 확인합니다', kind: 'browser' },
      { id: 'auth-vault', label: '저장된 네이버 계정 확인', detail: '정확히 일치하는 origin만 OS 암호화 저장소에서 조회합니다', kind: 'auth' },
      { id: 'auth-method', label: '로그인 방식 선택', detail: 'passkey를 우선하고 저장된 로그인은 1회 승인 후 사용합니다', kind: 'auth' },
      { id: 'auth-device', label: '기기 인증 대기', detail: 'Touch ID, Windows Hello, 기기 암호 또는 연결 기기에서 직접 승인합니다', kind: 'guard' },
      { id: 'auth-verify', label: '로그인 상태 확인', detail: '암호 입력란이 사라진 뒤 signed-in 상태를 다시 확인합니다', kind: 'auth' },
      { id: 'result', label: '결과 전달', detail: '로그인 완료 또는 대기 상태를 채팅에 알려줍니다', kind: 'result' },
    ];
  }
  const steps: SkillRouteStep[] = [
    { id: 'route', label: 'Select skills', detail: skills.map((skill) => skill.name).join(', ') || 'No enabled skill', kind: 'route' },
  ];
  steps.push(...skills.filter((skill) => skill.id !== 'xgen.login-assistant').map((skill): SkillRouteStep => ({
    id: skill.id,
    label: skill.id === 'xgen.browser-navigation' && host ? `${skill.progress.label}: ${host}` : skill.progress.label,
    detail: skill.progress.detail,
    kind: stepKind(skill.id),
  })));
  steps.push({ id: 'result', label: 'Return result', detail: 'Save the run trace and artifacts locally', kind: 'result' });
  return steps;
}

function stepKind(skillId: string): SkillRouteStep['kind'] {
  if (skillId === 'xgen.web-research' || skillId === 'xgen.multi-page-research') return 'research';
  if (skillId === 'xgen.page-reader') return 'page';
  if (skillId === 'xgen.browser-navigation') return 'browser';
  if (skillId === 'xgen.browser-interaction') return 'interaction';
  if (skillId === 'xgen.structured-extraction') return 'extract';
  if (skillId === 'xgen.form-guard') return 'guard';
  if (skillId === 'xgen.login-assistant') return 'auth';
  return 'route';
}

function routeReason(skills: LoadedSkillPackage[], host: string, mode: ResolvedAgentMode): string {
  if (!skills.length) return 'No enabled Skill can complete this request.';
  const names = skills.map((skill) => skill.name).join(', ');
  if (mode === 'browser-agent') return `${host || 'The visible browser'} requires ${names}.`;
  if (mode === 'search') return `${names} will research current sources without browser control.`;
  if (mode === 'page') return `${names} will use the attached page context.`;
  return `${names} matches this request.`;
}

function toRoutedSkill(skill: LoadedSkillPackage): RoutedSkill {
  return {
    id: skill.id,
    settingKey: skill.settingKey,
    name: skill.name,
    description: skill.description,
    domain: skill.domain,
    risk: skill.permissions.risk,
    runtime: skill.runtime,
    permissions: skill.permissions,
    progress: skill.progress,
  };
}

function extractUrl(prompt: string): string | undefined {
  return prompt.match(/https?:\/\/[^\s<>()"']+/i)?.[0];
}

function hostFromUrl(url?: string): string {
  if (!url) return '';
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}

function uniqueActions(actions: BrowserActionCategory[]): BrowserActionCategory[] {
  return [...new Set(actions)];
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.filter((id) => /^[A-Za-z0-9._:-]{1,100}$/.test(id)))].slice(0, 12);
}
