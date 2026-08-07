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
  assert.equal(route.browserRequired, false);
  assert.deepEqual(route.browserActionCategories, []);
  assert.deepEqual(route.skills.map((skill) => skill.id), ['xgen.chat-answer']);
});

test('routes URL extraction through navigation and extraction skills', async () => {
  const route = await router().route({
    ...baseRequest,
    prompt: 'https://example.com/pricing 페이지를 열고 가격을 JSON으로 추출해줘',
  });
  assert.equal(route.browserRequired, true);
  assert.deepEqual(route.skills.map((skill) => skill.id), ['xgen.browser-navigate', 'xgen.data-extract']);
  assert.equal(route.browserActionCategories.includes('navigate'), true);
  assert.equal(route.browserActionCategories.includes('get'), true);
  assert.equal(route.browserActionCategories.includes('fill'), false);
});

test('adds form guard only for interactive browser requests', async () => {
  const route = await router().route({
    ...baseRequest,
    prompt: 'https://example.com/form 을 열고 이름을 입력해줘',
  });
  assert.equal(route.skills.some((skill) => skill.id === 'xgen.form-guard'), true);
  assert.equal(route.browserActionCategories.includes('fill'), true);
  assert.equal(route.browserActionCategories.includes('click'), true);
});

test('blocks browser execution when every required browser skill is disabled', async () => {
  const route = await router({
    'global:browser-navigation': false,
    'global:data-extraction': false,
  }).route({
    ...baseRequest,
    prompt: 'https://example.com 에서 가격을 추출해줘',
  });
  assert.equal(route.browserRequired, false);
  assert.ok(route.blockedReason);
});

function router(skillEnabled: Record<string, boolean> = {}): SkillRouter {
  const settings: AppSettings = {
    schemaVersion: 1,
    general: { guard: true, localLogs: true, compact: false },
    mcpEnabled: { browser: true },
    skillEnabled,
  };
  return new SkillRouter({ load: async () => settings } as LocalSettingsStore);
}
