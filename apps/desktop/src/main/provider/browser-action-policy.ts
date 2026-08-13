import type { AgentPermissionMode, AppSettings } from '../../shared/contracts';

const actionByTool: Readonly<Record<string, string>> = {
  agent_browser_open: 'navigate',
  agent_browser_read: 'read',
  agent_browser_snapshot: 'snapshot',
  agent_browser_click: 'click',
  agent_browser_fill: 'fill',
  agent_browser_type: 'type',
  agent_browser_press: 'press',
  agent_browser_check: 'check',
  agent_browser_uncheck: 'uncheck',
  agent_browser_select: 'select',
  agent_browser_upload: 'upload',
  agent_browser_download: 'download',
  agent_browser_scroll: 'scroll',
  agent_browser_wait_ms: 'wait',
  agent_browser_wait_for_selector: 'wait',
  agent_browser_wait_for_text: 'wait',
  agent_browser_wait_for_load: 'waitforloadstate',
  agent_browser_screenshot: 'screenshot',
  agent_browser_get_text: 'gettext',
  agent_browser_get_url: 'url',
  agent_browser_get_title: 'title',
  agent_browser_close: 'close',
  agent_browser_back: 'back',
  agent_browser_forward: 'forward',
  agent_browser_reload: 'reload',
  agent_browser_tab_new: 'tab_new',
  agent_browser_tab_list: 'tab_list',
  agent_browser_tab_switch: 'tab_switch',
  agent_browser_tab_close: 'tab_close',
  agent_browser_window_new: 'window_new',
  agent_browser_frame_switch: 'frame',
  agent_browser_frame_main: 'frame',
  agent_browser_dialog_status: 'dialog',
  agent_browser_dialog_accept: 'dialog',
  agent_browser_dialog_dismiss: 'dialog',
};

export interface BrowserActionPolicyDocument {
  default: 'deny';
  allow: string[];
  confirm: string[];
  deny: string[];
}

const readOnlyActions = new Set(['launch', 'navigate', 'back', 'forward', 'reload', 'tab_new', 'tab_list', 'tab_switch', 'read', 'snapshot', 'scroll', 'wait', 'waitforloadstate', 'gettext', 'url', 'title', 'screenshot']);
const alwaysDeniedActions = new Set(['eval', 'network', 'state']);

export function browserActionPolicy(
  tools: string[],
  permissions: AppSettings['browserPermissions'],
  mode: AgentPermissionMode = 'guard',
): BrowserActionPolicyDocument {
  const selectedActions = new Set([
    'launch',
    ...tools.map((tool) => actionByTool[tool]).filter((action): action is string => Boolean(action)),
  ]);
  const confirm: string[] = [];
  const deny = new Set(alwaysDeniedActions);

  for (const action of selectedActions) {
    if (mode === 'read-only' && !readOnlyActions.has(action)) deny.add(action);
    if (mode === 'guard' && !readOnlyActions.has(action)) confirm.push(action);
  }
  for (const action of ['upload', 'download'] as const) {
    if (!selectedActions.has(action)) continue;
    const decision = permissions[action];
    if (decision === 'ask' && !confirm.includes(action)) confirm.push(action);
    if (decision === 'deny') deny.add(action);
  }
  const effectiveConfirm = confirm.filter((action) => !deny.has(action));
  const allow = [...selectedActions].filter((action) => !effectiveConfirm.includes(action) && !deny.has(action));
  if (effectiveConfirm.length) allow.push('confirm', 'deny');
  return { default: 'deny', allow, confirm: effectiveConfirm, deny: [...deny] };
}

export function browserPolicyActions(tools: string[]): string[] {
  return browserActionPolicy(tools, { upload: 'allow', download: 'allow' }, 'full-access').allow;
}
