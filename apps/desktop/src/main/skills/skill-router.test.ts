import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRunRequest, AppSettings } from '../../shared/contracts';
import type { LocalSettingsStore } from '../storage/local-settings-store';
import { SkillRouter } from './skill-router';

const baseRequest: AgentRunRequest = {
  providerId: 'codex',
  model: 'gpt-5.6-sol',
  mode: 'chat',
  prompt: '안녕하세요',
};

test('routes ordinary chat without exposing browser actions', async () => {
  const route = await router().route(baseRequest);
  assert.equal(route.browserVisible, false);
  assert.equal(route.agentBrowserRequired, false);
  assert.deepEqual(route.browserActionCategories, []);
  assert.deepEqual(route.skills.map((skill) => skill.id), ['xgen.conversation']);
});

test('keeps URL prompts in chat isolated from the browser', async () => {
  const route = await router().route({
    ...baseRequest,
    prompt: 'https://example.com/pricing 페이지를 열고 가격을 JSON으로 추출해줘',
  });
  assert.equal(route.agentBrowserRequired, false);
  assert.deepEqual(route.skills.map((skill) => skill.id), ['xgen.conversation']);
});

test('auto keeps stable questions in conversation mode', async () => {
  const route = await router().route({ ...baseRequest, mode: 'auto', prompt: '마크다운 표 만드는 법 알려줘' });
  assert.equal(route.resolvedMode, 'chat');
  assert.equal(route.agentBrowserRequired, false);
});

test('auto selects read-only research for current information', async () => {
  const route = await router().route({ ...baseRequest, mode: 'auto', prompt: '오늘 서울 날씨를 찾아줘' });
  assert.equal(route.resolvedMode, 'search');
  assert.equal(route.browserVisible, false);
  assert.equal(route.agentBrowserRequired, false);
  assert.equal(route.browserActionCategories.includes('fill'), false);
});

test('auto honors an explicit no-web boundary', async () => {
  const route = await router().route({ ...baseRequest, mode: 'auto', prompt: '웹 없이 이 문장을 요약해줘' });
  assert.equal(route.resolvedMode, 'chat');
  assert.equal(route.agentBrowserRequired, false);
});

test('auto selects browser work for interaction requests without attached page context', async () => {
  const route = await router().route({ ...baseRequest, mode: 'auto', prompt: 'example.com을 열어줘' });
  assert.equal(route.resolvedMode, 'browser-agent');
  assert.equal(route.agentBrowserRequired, true);
});

test('auto recognizes the Korean connective form for browser navigation', async () => {
  const route = await router().route({ ...baseRequest, mode: 'auto', prompt: 'example.com을 열고 페이지 제목을 알려줘' });
  assert.equal(route.resolvedMode, 'browser-agent');
  assert.equal(route.agentBrowserRequired, true);
});

test('auto uses the visible browser for cross-retailer price and benefit comparisons', async () => {
  const route = await router().route({
    ...baseRequest,
    mode: 'auto',
    prompt: '홈쇼핑에서 잘 팔리는 상품 10개를 찾아서 현대홈쇼핑과 GS 홈쇼핑에도 팔고있는지 비교해줘. 가격과 혜택 차이도 비교해줘',
    pageContext: pageContext('https://www.lotteimall.com/main/viewMain.lotte'),
  });
  assert.equal(route.resolvedMode, 'browser-agent');
  assert.equal(route.browserVisible, true);
  assert.equal(route.agentBrowserRequired, true);
  assert.deepEqual(route.skills.map((skill) => skill.id), ['xgen.browser-navigation', 'xgen.structured-extraction']);
});

test('auto uses the attached page for ordinary page questions', async () => {
  const route = await router().route({ ...baseRequest, mode: 'auto', prompt: '핵심 내용을 요약해줘', pageContext: pageContext('https://example.com') });
  assert.equal(route.resolvedMode, 'page');
  assert.equal(route.agentBrowserRequired, false);
});

test('routes research through provider web search without agent-browser', async () => {
  const route = await router().route({ ...baseRequest, mode: 'search', prompt: '오늘 서울 날씨를 찾아줘' });
  assert.equal(route.browserVisible, false);
  assert.equal(route.agentBrowserRequired, false);
  assert.deepEqual(route.skills.map((skill) => skill.id), ['xgen.web-research']);
  assert.deepEqual(route.browserActionCategories, []);
});

test('adds bounded multi-page research for cross-source requests', async () => {
  const route = await router().route({ ...baseRequest, mode: 'auto', prompt: '이 주제를 여러 출처로 교차 검증해서 리서치 보고서로 만들어줘' });
  assert.equal(route.resolvedMode, 'search');
  assert.equal(route.browserVisible, false);
  assert.equal(route.agentBrowserRequired, false);
  assert.deepEqual(route.skills.map((skill) => skill.id), ['xgen.multi-page-research', 'xgen.web-research']);
  const instructions = router().instructionsFor(route);
  assert.match(instructions, /<skill name="xgen\.multi-page-research">/);
  assert.match(instructions, /<skill_resource path="references\/source-ledger\.md">/);
});

test('routes Browser Agent extraction through navigation and extraction skills', async () => {
  const route = await router().route({
    ...baseRequest,
    mode: 'browser-agent',
    prompt: '현재 페이지 가격을 JSON으로 추출해줘',
    pageContext: pageContext('https://example.com/pricing'),
  });
  assert.equal(route.agentBrowserRequired, true);
  assert.deepEqual(route.skills.map((skill) => skill.id), ['xgen.browser-navigation', 'xgen.structured-extraction']);
});

test('adds interaction tools without a consequential guard for reversible input', async () => {
  const route = await router().route({
    ...baseRequest,
    mode: 'browser-agent',
    prompt: '현재 폼에 이름을 입력해줘',
    pageContext: pageContext('https://example.com/form'),
  });
  assert.equal(route.skills.some((skill) => skill.id === 'xgen.browser-interaction'), true);
  assert.equal(route.skills.some((skill) => skill.id === 'xgen.form-guard'), false);
  assert.equal(route.browserActionCategories.includes('fill'), true);
  assert.equal(route.browserActionCategories.includes('click'), true);
});

test('adds form guard when a consequential browser action is requested', async () => {
  const route = await router().route({
    ...baseRequest,
    mode: 'browser-agent',
    prompt: '현재 폼을 제출해줘',
    pageContext: pageContext('https://example.com/form'),
  });
  assert.equal(route.skills.some((skill) => skill.id === 'xgen.form-guard'), true);
});

test('blocks browser execution when every required browser skill is disabled', async () => {
  const route = await router({
    'global:browser-navigation': false,
    'global:structured-extraction': false,
  }).route({
    ...baseRequest,
    mode: 'browser-agent',
    prompt: '현재 페이지에서 가격을 추출해줘',
    pageContext: pageContext('https://example.com'),
  });
  assert.equal(route.agentBrowserRequired, false);
  assert.ok(route.blockedReason);
});

test('loads the real Skill packages and their runtime bindings', () => {
  const catalog = router().list();
  assert.equal(catalog.length, 8);
  assert.equal(catalog.find((skill) => skill.id === 'xgen.web-research')?.runtime.kind, 'provider-web');
  assert.deepEqual(catalog.find((skill) => skill.id === 'xgen.browser-navigation')?.runtime.toolProfiles, ['core', 'tabs']);
  assert.match(catalog.find((skill) => skill.id === 'xgen.form-guard')?.markdown ?? '', /## Workflow/);
});

test('injects selected Skill workflows and reference contracts into provider context', async () => {
  const skillRouter = router();
  const route = await skillRouter.route({
    ...baseRequest,
    mode: 'browser-agent',
    prompt: '현재 페이지 가격을 JSON으로 추출해줘',
    pageContext: pageContext('https://example.com/pricing'),
  });
  const instructions = skillRouter.instructionsFor(route);
  assert.match(instructions, /<skill name="xgen\.browser-navigation">/);
  assert.match(instructions, /<skill_resource path="references\/tool-contract\.md">/);
  assert.match(instructions, /<skill_resource path="references\/output-contract\.md">/);
});

test('explicit Skill selection determines the execution boundary in Auto mode', async () => {
  const route = await router().route({
    ...baseRequest,
    mode: 'auto',
    prompt: '가격을 정리해줘',
    selectedSkillIds: ['xgen.structured-extraction'],
  });
  assert.equal(route.resolvedMode, 'browser-agent');
  assert.deepEqual(route.skills.map((skill) => skill.id), ['xgen.browser-navigation', 'xgen.structured-extraction']);
  assert.equal(route.agentBrowserRequired, true);
});

test('explicit conversation Skill keeps a current-looking request offline', async () => {
  const route = await router().route({
    ...baseRequest,
    mode: 'auto',
    prompt: '최신 정보처럼 보이는 문장을 다듬어줘',
    selectedSkillIds: ['xgen.conversation'],
  });
  assert.equal(route.resolvedMode, 'chat');
  assert.deepEqual(route.skills.map((skill) => skill.id), ['xgen.conversation']);
});

test('blocks an explicitly selected Skill that is disabled', async () => {
  const route = await router({ 'global:structured-extraction': false }).route({
    ...baseRequest,
    mode: 'auto',
    prompt: '가격을 정리해줘',
    selectedSkillIds: ['xgen.structured-extraction'],
  });
  assert.match(route.blockedReason ?? '', /disabled/);
});

test('blocks an unknown explicitly selected Skill', async () => {
  const route = await router().route({
    ...baseRequest,
    mode: 'auto',
    prompt: '작업해줘',
    selectedSkillIds: ['custom.unknown'],
  });
  assert.match(route.blockedReason ?? '', /Unknown selected Skill/);
});

function router(skillEnabled: Record<string, boolean> = {}): SkillRouter {
  const settings: AppSettings = {
    schemaVersion: 1,
    general: { defaultPermissionMode: 'guard', localLogs: true, compact: false },
    browserPermissions: { upload: 'ask', download: 'ask' },
    mcpEnabled: { browser: true },
    skillEnabled,
  };
  return new SkillRouter({ load: async () => settings } as LocalSettingsStore);
}

function pageContext(url: string) {
  return { tabId: 'tab-1', title: 'Example', url, selection: '', text: 'Example page', capturedAt: new Date().toISOString() };
}
