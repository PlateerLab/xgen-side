import assert from 'node:assert/strict';
import test from 'node:test';
import type { PersistedRunActivity, SkillRoute } from '../../shared/contracts';
import { activityLabel } from './activity-label';

const conversationRoute = {
  skills: [{ id: 'xgen.conversation' }],
} as SkillRoute;

test('keeps the full filename for document read activities', () => {
  const activities = [{ id: 'read-1', name: 'Read northstar-launch-brief.docx', phase: 'completed' }] as PersistedRunActivity[];
  assert.equal(activityLabel(activities[0]!.name, 0, activities, conversationRoute), 'Read northstar-launch-brief.docx');
});

test('keeps tool labels concise for ordinary activities', () => {
  assert.equal(activityLabel('Local command', 0, [], conversationRoute), 'Local command');
  assert.equal(activityLabel('agent_browser_get_title', 0, [], conversationRoute), 'get title');
});
