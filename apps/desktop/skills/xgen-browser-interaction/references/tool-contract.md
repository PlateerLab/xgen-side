# Browser Interaction Tool Contract

## Tool choice

- Click a visible control: `agent_browser_click`
- Replace an input value: `agent_browser_fill`
- Append text or type progressively: `agent_browser_type`
- Choose a select option: `agent_browser_select`
- Toggle a checkbox: `agent_browser_check` or `agent_browser_uncheck`
- Submit a non-consequential keyboard action: `agent_browser_press`
- Observe a result with `agent_browser_wait_for_selector`, `agent_browser_wait_for_text`, or `agent_browser_wait_for_load`, then call `agent_browser_snapshot`

## Recovery

- If an element ref fails, take one fresh snapshot and locate it again.
- If multiple controls match, use their accessible name and surrounding context.
- If the action changes external state, stop before executing it and activate Form Guard.
- Never fall back to JavaScript evaluation when a supported interaction tool fails.
