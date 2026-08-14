# Design QA

## One-depth full-window Settings navigation

- Source visual truth: `.audit/xgen-settings-sidebar-2026-08-14/00-settings-reference.png`
- Rendered implementation: `.audit/xgen-settings-sidebar-2026-08-14/02-settings-general-final.png`
- Search and Skills state: `.audit/xgen-settings-sidebar-2026-08-14/03-settings-search-skills.png`
- Permissions state: `.audit/xgen-settings-sidebar-2026-08-14/04-settings-permissions.png`
- Full-view comparison: `.audit/xgen-settings-sidebar-2026-08-14/settings-comparison.png`
- Source pixels: 3074 by 1914. Implementation pixels: 945 by 768. The comparison proportionally normalizes the source to 945 by 588 and places it on a 945 by 591 comparison region, then compares it with the implementation's top 945 by 591 region without stretching either image.
- State: dark macOS app, Settings General selected, sidebar and search visible, full remaining window used by detail content.

### Findings

- [Resolved P1] The app sidebar remained visible while a second settings sidebar was inserted inside the content area. This duplicated the first navigation depth and reduced usable detail width. Settings now replaces the app sidebar and owns one flush full-height navigation column.
- [Resolved P1] Settings content previously started after both the 220 pixel app offset and the 182 pixel internal navigation, which visibly clipped workbench screens. The full settings surface now starts at the window edge and gives the detail workspace all width after one 220 pixel sidebar.
- [Resolved P2] There was no direct return control or settings-wide search. `앱으로 돌아가기` restores the previous app surface, and the search field filters the first-level menu by English and Korean keywords.
- [Resolved P2] Permissions shared the General destination and could produce an ambiguous active state. Permissions is now a separate first-level section with its own content.
- Fonts and typography: compact system UI sizing and weights follow the supplied dark desktop reference while retaining XGEN terminology.
- Spacing and layout rhythm: the sidebar occupies the same approximate screen proportion as the reference, rows use one compact vertical rhythm, and detail cards expand responsively without a second top-level column.
- Colors and visual tokens: the sidebar and main workspace use distinct charcoal surfaces, a quiet selected row, low-contrast separators, and accessible focus borders.
- Image quality and asset fidelity: this settings state uses Fluent UI vector icons and contains no raster assets requiring recreation.
- Copy and content: the required return action and search placeholder are present; XGEN-specific General, AI, Auto login, Skills, MCPs, Permissions, and Local data labels are retained.

### Interaction verification

- Settings entry from the profile menu: passed.
- Search for `skill` filtering to the Skills destination: passed.
- Opening Skills from the filtered result: passed.
- Opening the separate Permissions destination: passed.
- Returning to the previous chat surface: passed.
- Type checking, all 106 desktop tests, production build, package verification, macOS arm64 packaging, and packaged-app launch: passed.
- No actionable P0, P1, or P2 issue remains in this settings pass.


## Aside chat composer, Ask AI, Side chat, and Skills parity

- Source Ask AI: `.audit/aside-chat-skills-2026-08-14/screenshots/01-aside-new-tab-ask-ai.png`
- Source Reply and Agent chat: `.audit/aside-chat-skills-2026-08-14/screenshots/02-aside-agent-chat-reply-and-sidepanel.png`
- Source Side chat: `.audit/aside-chat-skills-2026-08-14/screenshots/06-aside-side-chat.png`
- XGEN regular chat: `.audit/xgen-aside-chat-skills-2026-08-14/screenshots/01-xgen-regular-chat.png`
- XGEN Agent Side chat: `.audit/xgen-aside-chat-skills-2026-08-14/screenshots/02-xgen-agent-side-chat-running.png`
- XGEN Ask AI: `.audit/xgen-aside-chat-skills-2026-08-14/screenshots/04-xgen-new-tab-ask-ai.png`
- XGEN Skills: `.audit/xgen-aside-chat-skills-2026-08-14/screenshots/05-xgen-skills-settings.png`
- Final Ask AI implementation: `.audit/xgen-aside-chat-skills-2026-08-14/screenshots/09-xgen-final-ask-ai-adjusted.png`
- Final same-tab Side chat follow-up: `.audit/xgen-aside-chat-skills-2026-08-14/screenshots/11-xgen-final-side-chat-latest.png`
- Final Ask AI comparison: `.audit/xgen-aside-chat-skills-2026-08-14/comparison-ask-ai-final.png`
- Final Side chat comparison: `.audit/xgen-aside-chat-skills-2026-08-14/comparison-side-chat-final.png`
- State: dark macOS app, sidebar open, compact system typography, prompt pill with lower tool row

### Findings

- [Resolved P1] A linked Agent browser tab previously replaced the composer with a read-only execution-record footer. It now resolves the owning chat by run ID, displays the same transcript, and renders a real Side chat composer.
- [Resolved P1] Agent follow-ups previously had no submission path. A completed linked tab now sends the next message into the owning chat and requests the current visible browser tab for the next run.
- [Resolved P1] The first packaged follow-up regression test exposed a missing current-page context, which created a second blank Agent tab. Side chat now sends the active page context with `browser-side` ownership. The final packaged run kept exactly one Agent tab and inspected the still-visible Example Domain page.
- [Resolved P1] New Tab Ask AI lacked the source lower tool row and used the Search leading icon. Ask AI now has the observed source hierarchy, placeholder, switch, Project, Guard, model, reasoning, context, microphone, and conditional send action.
- [Resolved P2] Regular and Side chat composers were framed as one large card. They now separate the rounded prompt pill from the lower controls like the source.
- [Resolved P2] Switching from an Agent tab to an ordinary browser tab left Side chat open. Ordinary tab selection now closes the run-linked Side chat.
- [Resolved P2] Settings identified every settings view as AI in the left tab list. It now uses the accurate generic Settings label.
- [Resolved P1] Password Manager was not represented as its own Skill package. Settings now exposes a guarded, origin-matched package without copying Aside source or exposing credential plaintext.

### Verification

- Real XGEN browser run: example.com opened in the central browser and completed as Example Domain.
- Real XGEN Side chat follow-up: the single Agent tab remained selected, the full transcript stayed visible, the central BrowserView remained on example.com, and the response returned the page's first sentence.
- Type checking: passed.
- Desktop tests: 106 of 106 passed after the final same-tab fix.
- Production renderer and main-process build: passed.
- macOS arm64 unpacked package verification, packaging, launch, and Computer Use regression flow: passed. Code signing remains a release gate.


## Browser tab identity and user message wrapping regression

- Before: `artifacts/xgen-side-qa/tab-id-and-message-wrap-fix/01-before.jpeg`
- After: `artifacts/xgen-side-qa/tab-id-and-message-wrap-fix/02-after.jpeg`
- Combined comparison: `artifacts/xgen-side-qa/tab-id-and-message-wrap-fix/03-before-after-comparison.jpeg`
- State: dark theme, 945 by 768 pixel viewport, selected “네이버 로그인해줘” chat, collapsed completed run, fixed bottom composer
- Density normalization: neither side was resized. The fresh capture was cropped by 19 horizontal pixels to the same 945 by 768 comparison viewport.

### Findings

- [Resolved P1] The run prompt exposed an Electron CDP target id as though it were an agent-browser tab selector. The recorded failing run listed `t1` as the active run-owned tab and then attempted to switch to the unrelated CDP id, so navigation stopped before Naver opened.
- The prompt now keeps the run-owned tab active and allows switching only with the ids or labels returned by the current tab list. A regression test proves that the CDP id is absent from provider instructions.
- A fresh real run listed the active tab, opened Naver, reached the login page, attempted the available passkey path, and completed at the QR device-verification boundary. It did not produce a tab-switch activity or the prior missing-tab error.
- [Resolved P2] The user bubble parent previously shrink-wrapped to the Korean phrase's minimum content width, forcing “네이버 로그인해줘” onto two lines. The parent now reserves the normal 620 pixel message measure while the bubble itself remains content-sized and right aligned.
- In the same 945 by 768 state, the user request is now one line. Longer requests wrap only after using the available message measure, matching the supplied Codex reference behavior.
- No actionable P0, P1, or P2 mismatch remains for this regression.

### Verification

- `pnpm --dir apps/desktop run typecheck`: passed.
- `pnpm --dir apps/desktop run test`: 89 of 89 tests passed.
- `pnpm --dir apps/desktop run build`: passed.

## Secure browser login comparison

- Collapsed source: `artifacts/aside-naver-login-flow/replay-2026-08-13/01-aside-collapsed-source.jpeg`
- Expanded source: `artifacts/aside-naver-login-flow/replay-2026-08-13/02-aside-expanded-source.jpeg`
- Collapsed implementation: `artifacts/aside-naver-login-flow/replay-2026-08-13/03-xgen-collapsed-implementation.jpeg`
- Expanded implementation: `artifacts/aside-naver-login-flow/replay-2026-08-13/04-xgen-expanded-implementation.jpeg`
- Collapsed comparison: `artifacts/aside-naver-login-flow/replay-2026-08-13/05-collapsed-comparison.jpeg`
- Expanded comparison: `artifacts/aside-naver-login-flow/replay-2026-08-13/06-expanded-comparison.jpeg`
- State: dark theme, 220 pixel sidebar, “네이버 로그인해줘” request, completed run disclosure, device-verification handoff, fixed bottom composer
- Viewport: every source and implementation capture is 945 by 768 pixels. Both comparison pairs were composed from the native captures without resizing either side.

### Login flow findings

- The actual Aside run is a chronological chat stream. Its stored trace shows tab inspection, Password Manager selection, `USER.md` reading, Naver navigation, login-state inspection, saved-account lookup, login-page inspection, passkey attempt, device-request inspection, and QR fallback before the final native-device handoff.
- XGEN now follows the same presentation contract: one compact `Worked for` disclosure, only events that actually occurred, the selected login skill inserted after the first orientation step, browser captures inline between events, and the final handoff directly below the trace.
- The previous predeclared seven-step plan, large authentication banner, run-status pill, automatic home Browser Activity rail, and numbered future steps were removed because they did not match Aside's observed behavior.
- Actual run activities and inline captures now persist locally with the chat and restore after a full app restart. A stale `running` record restores as cancelled rather than pretending that an interrupted process is still active.
- Browser captures are limited to meaningful visual milestones. Login, sign-in, passkey, authentication, and QR URLs persist only a truthful top crop that excludes password, OTP, QR, and passkey challenge regions. Raw sensitive-page captures are rejected by workspace sanitization.
- The final real XGEN run inspected the visible Naver QR challenge, stopped at device verification, and rendered one protected login-page crop. No QR code, password, one-time code, passkey challenge, or credential value is present in the saved comparison evidence.
- No actionable P0, P1, or P2 visual mismatch remains in the collapsed and expanded 945 by 768 login-chat states.
- [P3] Aside's source trace includes its product-specific `Password Manager` and `USER.md` rows. XGEN uses `Login Assistant` and shows the smaller set of events that occurred in its current run because the Naver QR tab was already open.

### Login interaction checks

- “네이버 로그인해줘” routes to Browser Navigation, Login Assistant, and Form Guard in Auto mode.
- The run creates an agent-owned visible browser tab and renders observed activity as events arrive instead of fabricating future steps.
- The secure vault broker accepts one authenticated run capability, resolves only an exact-origin entry, and refuses reuse or invalid tokens.
- macOS and Windows copy was verified separately for Touch ID and Windows Hello.
- The local Codex subscription executed the real Naver flow successfully through the device-verification boundary. No account, password, biometric prompt, QR scan, or OAuth grant was approved during QA.
- A fresh Aside replay was blocked by the existing native passkey prompt that still dimmed its window. The prompt was not approved or dismissed. The complete stored run record and its actual source captures were used as the visual and behavioral source of truth.
- `pnpm --dir apps/desktop run typecheck`: passed.
- `pnpm --dir apps/desktop run test`: 89 of 89 tests passed.
- `pnpm --dir apps/desktop run build`: passed.
- `git diff --check`: passed.

## Comparison target

- Source visual truth: `artifacts/xgen-side-qa/new-tab-aside-full.jpeg`
- Rendered implementation: `artifacts/xgen-side-qa/new-tab-implementation-final.jpeg`
- Combined comparison: `artifacts/xgen-side-qa/new-tab-comparison-final.jpeg`
- State: dark theme, sidebar open, blank browser tab, Search mode selected, suggested tasks expanded
- Viewport: both desktop app captures are 1228 by 768 pixels in macOS full screen
- Density normalization: no resize or density conversion was applied. Both captures came from the same Computer Use capture service on the same display and were combined at native pixel size. The desktop capture service does not expose an independent CSS viewport or device scale factor, so the matching capture pixel size is the comparison contract for this pass.

### Chat state comparison

- Source visual truth: `artifacts/xgen-side-qa/chat-aside-full.jpeg`
- Rendered implementation: `artifacts/xgen-side-qa/chat-xgen-failure.jpeg`
- Combined comparison: `artifacts/xgen-side-qa/chat-comparison-full.jpeg`
- State: dark theme, sidebar open, selected chat, right-aligned user request, interrupted or failed run feedback, bottom composer

## Full-view comparison evidence

The final combined image places Aside on the left and XGEN Side on the right. The desktop shell, browser toolbar, left navigation hierarchy, centered search control, Suggested tasks heading, three-card grid, card proportions, corner radii, dark surfaces, and compact type hierarchy have matching composition and density. XGEN Side intentionally keeps its own name, task copy, Fluent icons, and generated card imagery.

The chat comparison also places Aside on the left and XGEN Side on the right. Sidebar width, section hierarchy, active chat treatment, compact title row, conversation width, right-aligned user message, interrupted or failed feedback, and fixed bottom composer follow the same visual structure. XGEN Side exposes a compact disclosure only when a run produced observed activity, and keeps simple failures as a direct chat response.

## Focused region comparison

The central new-tab region was inspected at native capture size because it contains the fidelity-critical search control, Search and Ask AI tabs, card imagery, icons, copy hierarchy, and actions. A separate crop was unnecessary because these controls remain legible in the 1228 by 768 combined source. The sidebar and browser toolbar were also checked in the full-view comparison.

## Required fidelity surfaces

- Fonts and typography: Both apps use compact system UI typography with similar hierarchy, weight, line height, truncation, and antialiasing. XGEN Side copy is partly Korean and intentionally wraps differently inside cards.
- Spacing and layout rhythm: Sidebar width, fixed toolbar, centered new-tab stack, search width, section gap, three-column grid, card aspect ratio, padding, radii, and vertical rhythm now track the source. The generated imagery is slightly more luminous, which is retained as XGEN-specific polish.
- Colors and visual tokens: Main surfaces use the same subdued charcoal and gray balance. Selected rows, borders, disabled controls, and card surfaces retain sufficient contrast without gradients implemented in CSS.
- Image quality and asset fidelity: The three XGEN backgrounds are original generated assets optimized to 1000 by 582 PNG files for the desktop bundle. They are sharp, correctly cropped with `object-fit: cover`, and paired with Fluent vector icons. No Aside logos, avatars, or proprietary raster assets ship in the implementation.
- Copy and content: Search, Ask AI, Suggested tasks, Use this prompt, and Open Settings preserve the source interaction language. Product names and task descriptions are XGEN-specific.

## Comparison history

### Iteration 1

- [P1] Suggested task cards used flat color blocks instead of image assets.
- [P2] The sidebar and central content were about 20 percent narrower than the source.
- [P2] The search and card stack sat too high and the card typography was undersized.
- Fixes: widened the sidebar and new-tab content, matched the source card aspect ratio and internal spacing, increased compact type sizes, corrected vertical gaps, and added real raster backgrounds with Fluent icons.

### Iteration 2

- [P1] Reference raster files recovered from the installed Aside bundle matched visually but were unsuitable to redistribute.
- Fixes: removed those copied files and generated three original XGEN-specific raster backgrounds with equivalent palette roles and card density. The source files remain recoverable from the installed Aside application and were not retained in the project.
- Post-fix evidence: `artifacts/xgen-side-qa/new-tab-comparison-final.jpeg`

### Iteration 3

- [P1] Chat messages were shared across chat rows, so switching chats could display the wrong transcript.
- [P1] Ask AI transferred the prompt but did not create an isolated chat and start its run as one action.
- [P1] Approval requests used a native browser confirmation surface that did not match the app.
- [P2] Search result rows kept long URLs instead of concise page or query titles.
- Fixes: introduced per-chat transcript state, immediate Ask AI execution, run-aware chat closing, an in-app approval card, failure and cancellation styling, and stable tab-title derivation.
- Post-fix evidence: `artifacts/xgen-side-qa/chat-comparison-full.jpeg`

## Findings

- No actionable P0, P1, or P2 visual mismatch remains for the P0 new-tab state.
- [P3] XGEN card backgrounds are more luminous than the muted Aside references. This is an intentional brand-safe asset deviation and can be tuned later if the broader XGEN visual system becomes quieter.
- [P3] Sidebar content differs because XGEN shows realistic sample chats while the source capture contains settings tabs. This does not change structure or interaction density.
- [P3] Provider-specific metadata remains visible below XGEN responses as a muted local-record line. Aside uses a timestamp and feedback actions in the same area.

## Interaction and engineering checks

- Primary interactions tested: app launch, new browser tab creation, blank-tab selection, Search and Ask AI switching, Search submission into the active browser tab, Ask AI chat creation and immediate provider execution, chat switching with transcript restoration, normal browser tab activation, live browser page rendering, browser agent panel opening, new-chat creation, and local chat and browser-tab restoration after a full app restart.
- Secure login proof: submitting `네이버 로그인해줘` from the browser Ask AI panel selected Browser Navigation, Login Assistant, and Form Guard; inspected the visible Naver QR challenge; captured the browser state; stopped further browser actions; and reported `기기 인증 대기 중입니다`. The final XGEN evidence is `artifacts/aside-naver-login-flow/07-xgen-browser-ask-ai-qr-waiting.jpeg`, while the Aside source behavior remains grounded by `artifacts/aside-naver-login-flow/01-chat-passkey-waiting.jpeg` and the combined Aside-to-XGEN login UI comparison at `artifacts/aside-naver-login-flow/05-aside-xgen-login-comparison.png`.
- Credential approval proof: login-page and QR controls continue without generic Guard interruptions. Exact-origin saved credentials remain blocked inside the local credential broker until the trusted XGEN approval UI resolves the one-time request. No matching Naver credential was present during the real-site run, so no credential approval was requested and no secret was read.
- Search proof: submitting `OpenAI Codex` navigated the active browser view to the corresponding Google search URL. Google presented its automated-traffic challenge in the test environment, which was left untouched.
- Ask AI proof: submitting a task created a titled chat, transferred the user message, started the provider route, and rendered the failed state when the local Codex CLI was unavailable.
- Console errors checked: the Electron development stream showed successful renderer hot updates and no renderer exception during the tested flow.
- `pnpm typecheck:xgen-side`: passed.
- `pnpm build:xgen-side`: passed.
- `git diff --check`: passed.
- `pnpm test:xgen-side`: 91 of 91 tests passed on macOS. Platform contract tests cover macOS and Windows binary naming, executable discovery, login terminal construction, environment inheritance, command policies, credential-broker approval, QR waiting copy, browser-auth handoff, and workspace-state validation.

## Implementation checklist

- Preserve this P0 shell while implementing persisted bookmarks and projects.
- Repeat native-size comparison for new chat, running chat, browser agent panel, Skills, and Statistics when each state is changed.
- Run the full suite on Windows before a packaged dogfood milestone.

## Readability, snapshot ratio, and authentication handoff QA

- Source visual truth: `artifacts/xgen-side-qa/readability-auth-handoff/00-before-expanded.jpeg`
- Rendered implementation: `artifacts/xgen-side-qa/readability-auth-handoff/01-expanded-after.jpeg`
- Combined comparison: `artifacts/xgen-side-qa/readability-auth-handoff/03-before-after.jpeg`
- State: macOS desktop app at native 768-pixel capture height, sidebar open, completed `네이버 로그인해줘` chat, run disclosure expanded, browser activity snapshots visible.
- Typography: increased the compact UI scale across navigation, chat messages, run activity, settings, and composer controls while retaining the Aside-like dense hierarchy.
- Snapshot fidelity: removed forced `object-fit: cover` and fixed-ratio presentation. Normal browser evidence is captured as a 16:10 viewport crop and rendered at its natural ratio; protected login evidence keeps its deliberately shallow crop without being enlarged or horizontally clipped.
- Authentication handoff: a real macOS run automatically switched from chat to the agent-owned browser tab, loaded the Naver authentication page, displayed the in-app instruction `인증을 이 화면에서 완료하세요`, and exposed the live BrowserView for QR, passkey, or device approval interaction. No credential or QR challenge was submitted during QA.
- Privacy: the actual live QR screenshot was not persisted as QA evidence. Login snapshots continue to blur password, OTP, QR, canvas, and passkey-like elements before capture and are limited to the page header region.
- Automated checks: renderer handoff tests cover login-route tab reveal and agent-owned authentication-tab detection. Type checking, all 91 desktop tests, production build, and `git diff --check` passed.

final result: passed
