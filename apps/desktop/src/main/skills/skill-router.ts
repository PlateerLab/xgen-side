import { randomUUID } from 'node:crypto';
import type {
  AgentRunRequest,
  BrowserActionCategory,
  RoutedSkill,
  SkillRoute,
  SkillRouteStep,
} from '../../shared/contracts';
import { LocalSettingsStore } from '../storage/local-settings-store';

interface SkillManifest extends RoutedSkill {
  capabilities: Array<'chat' | 'search' | 'page' | 'browser'>;
  actions: BrowserActionCategory[];
}

const catalog = {
  chat: {
    id: 'xgen.chat-answer', settingKey: 'global:chat-answer', name: 'Conversation',
    description: '브라우저나 외부 도구 없이 요청에 답합니다.', domain: 'Every website', risk: 'read',
    capabilities: ['chat'], actions: [],
  },
  research: {
    id: 'xgen.web-research', settingKey: 'global:web-research', name: 'Web research',
    description: '웹 검색 결과를 출처와 함께 조사합니다.', domain: 'Every website', risk: 'read',
    capabilities: ['search'], actions: [],
  },
  page: {
    id: 'xgen.page-reader', settingKey: 'global:page-summarizer', name: 'Page reader',
    description: '현재 페이지 컨텍스트를 읽고 질문에 답합니다.', domain: 'Every website', risk: 'read',
    capabilities: ['page'], actions: [],
  },
  navigate: {
    id: 'xgen.browser-navigate', settingKey: 'global:browser-navigation', name: 'Browser navigation',
    description: '탭을 열고 URL로 이동하며 페이지 상태를 확인합니다.', domain: 'Every website', risk: 'write',
    capabilities: ['browser'], actions: ['navigate', 'snapshot', 'scroll', 'wait', 'read', 'get'],
  },
  extract: {
    id: 'xgen.data-extract', settingKey: 'global:data-extraction', name: 'Structured extraction',
    description: '페이지에서 요청한 정보를 읽어 구조화된 결과로 정리합니다.', domain: 'Every website', risk: 'read',
    capabilities: ['browser'], actions: ['snapshot', 'scroll', 'wait', 'read', 'get'],
  },
  form: {
    id: 'xgen.form-guard', settingKey: 'global:form-guard', name: 'Form guard',
    description: '입력과 클릭을 허용하되 제출과 중요한 동작은 승인 경계에서 멈춥니다.', domain: 'Every website', risk: 'consequential',
    capabilities: ['browser'], actions: ['navigate', 'snapshot', 'scroll', 'wait', 'read', 'get', 'click', 'fill', 'interact'],
  },
  github: {
    id: 'xgen.github-repository', settingKey: 'github:repo-navigator', name: 'Repository navigator',
    description: 'GitHub 저장소 구조와 코드 위치를 탐색합니다.', domain: 'github.com', risk: 'read',
    capabilities: ['browser'], actions: ['navigate', 'snapshot', 'scroll', 'wait', 'read', 'get', 'click'],
  },
} satisfies Record<string, SkillManifest>;

const browserIntent = /https?:\/\/|\b(open|navigate|browse|visit|extract|collect|scrape|download from)\b|브라우저|사이트(?:에|를)?\s*(?:열|접속|들어)|페이지(?:에|를)?\s*(?:열|이동)|추출|수집|가져와|찾아가/i;
const extractionIntent = /extract|collect|scrape|table|json|csv|price|list|추출|수집|표로|목록|가격|json|파일로/i;
const formIntent = /fill|type|click|select|form|sign in|login|입력|클릭|선택|로그인|신청|작성/i;

export class SkillRouter {
  constructor(private readonly settingsStore: LocalSettingsStore) {}

  async route(request: AgentRunRequest): Promise<SkillRoute> {
    const settings = await this.settingsStore.load();
    const targetUrl = request.pageContext?.url || extractUrl(request.prompt);
    const targetHost = hostFromUrl(targetUrl);
    const requested: SkillManifest[] = [];
    const needsBrowser = request.mode === 'browser-agent' || (request.mode === 'chat' && browserIntent.test(request.prompt));

    if (request.mode === 'search') requested.push(catalog.research);
    else if (request.mode === 'page') requested.push(catalog.page);
    else if (needsBrowser) {
      requested.push(catalog.navigate);
      if (extractionIntent.test(request.prompt)) requested.push(catalog.extract);
      if (formIntent.test(request.prompt)) requested.push(catalog.form);
      if (targetHost === 'github.com' || targetHost.endsWith('.github.com')) requested.push(catalog.github);
    } else requested.push(catalog.chat);

    const skills = uniqueSkills(requested).filter((skill) => settings.skillEnabled[skill.settingKey] !== false);
    const browserRequested = requested.some((skill) => skill.capabilities.includes('browser'));
    const browserRequired = skills.some((skill) => skill.capabilities.includes('browser'));
    const blockedReason = browserRequested && !browserRequired
      ? '이 요청에 필요한 Browser Skills가 설정에서 비활성화되어 있습니다.'
      : undefined;
    const browserActionCategories = uniqueActions(skills.flatMap((skill) => skill.actions));

    return {
      id: randomUUID(),
      reason: routeReason(skills, targetHost, browserRequired),
      browserRequired,
      targetUrl,
      targetHost: targetHost || undefined,
      browserActionCategories,
      skills: skills.map(({ capabilities: _capabilities, actions: _actions, ...skill }) => skill),
      steps: buildSteps(skills, targetHost, browserRequired),
      blockedReason,
    };
  }
}

function buildSteps(skills: SkillManifest[], host: string, browserRequired: boolean): SkillRouteStep[] {
  const steps: SkillRouteStep[] = [
    { id: 'route', label: 'Select skills', detail: skills.map((skill) => skill.name).join(', ') || 'No enabled skill', kind: 'route' },
  ];
  if (browserRequired) {
    steps.push({ id: 'browser', label: host ? `Open ${host}` : 'Open browser workspace', detail: 'XGEN Browser MCP · guarded local tab', kind: 'browser' });
  }
  if (skills.some((skill) => skill.id === catalog.extract.id)) {
    steps.push({ id: 'extract', label: 'Extract requested data', detail: 'Read-only page content with provenance boundaries', kind: 'extract' });
  }
  if (skills.some((skill) => skill.id === catalog.form.id)) {
    steps.push({ id: 'guard', label: 'Apply form guard', detail: 'Stop before submit, purchase, send, or credential disclosure', kind: 'guard' });
  }
  steps.push({ id: 'result', label: 'Return result', detail: 'Save the run trace and artifacts locally', kind: 'result' });
  return steps;
}

function routeReason(skills: SkillManifest[], host: string, browserRequired: boolean): string {
  if (!skills.length) return '필요한 Skill이 비활성화되어 실행할 수 없습니다.';
  if (browserRequired) return `${host || '현재 브라우저'} 작업이 필요해 ${skills.map((skill) => skill.name).join(', ')} Skill을 선택했습니다.`;
  return `${skills.map((skill) => skill.name).join(', ')} Skill이 요청에 가장 적합합니다.`;
}

function extractUrl(prompt: string): string | undefined {
  return prompt.match(/https?:\/\/[^\s<>()"']+/i)?.[0];
}

function hostFromUrl(url?: string): string {
  if (!url) return '';
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}

function uniqueSkills(skills: SkillManifest[]): SkillManifest[] {
  return [...new Map(skills.map((skill) => [skill.id, skill])).values()];
}

function uniqueActions(actions: BrowserActionCategory[]): BrowserActionCategory[] {
  return [...new Set(actions)];
}
