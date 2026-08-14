# Browser Navigation Tool Contract

## Preferred sequence

Do not pass `session`, `namespace`, `extraArgs`, `allowedDomains`, or any CDP connection option. XGEN Side binds every tool call to its authenticated run-owned tab.

1. `agent_browser_tab_list`
2. `agent_browser_tab_switch` when the target is not active
3. `agent_browser_open` when navigation is required
4. `agent_browser_snapshot`
5. Use `agent_browser_wait_for_selector`, `agent_browser_wait_for_text`, or `agent_browser_wait_for_load` after an action that changes page state
6. `agent_browser_get_title` and `agent_browser_get_url` for final verification

## Recovery

- Stale ref: take a new snapshot and retry once.
- Missing target: list tabs and match by title and URL.
- Load timeout: check the current URL and snapshot before deciding whether navigation failed.
- Authentication wall: stop and request user action. Do not ask for credentials in chat.
- Tool unavailable: report the missing capability instead of substituting shell or page evaluation.

## Success evidence

A navigation task succeeds only when the final browser state is observed through a fresh snapshot, title, URL, or visible screenshot.
