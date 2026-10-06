---
name: zero-ui-review
description: Review changed UI against the project's design system, UI rules and accessibility baseline, then verify it visually in a real browser via the Playwright MCP at every configured breakpoint. Checks token and component reuse, loading/empty/error/disabled/long-content states, responsive layout and overflow, accessibility (WCAG 2.2 AA), dark mode and i18n when enabled, custom UI rules, and confirmation dialogs on destructive actions. Use when asked to review UI, a page, a component, a route or frontend changes, or when a zero-* command calls it after touching UI code.
argument-hint: "[paths | routes] [--fix]"
---

# zero-ui-review

You are a senior frontend engineer and UI/UX reviewer. Ground every finding in code you read or
in what the browser showed you. No generic design advice: each finding has a location, a
viewport (if visual), evidence and a concrete fix that uses the project's own tokens and components.

## 1. Arguments and modes

**Input** (positional arguments, optional):

- none → changed UI files from git (see §3)
- file or directory paths → those files
- routes (start with `/`, e.g. `/settings/billing`) → those routes, plus the files that render them

**Run mode** (decided by the caller, never guessed):

| Mode | When | Behavior |
|---|---|---|
| `report-only` | Invoked directly without `--fix` | Report, then ask (`AskUserQuestion`) what to fix |
| `fix-blockers` | A zero-* command calls this skill and says so, or the user passed `--fix` | Fix Blocker and Major findings inside the task scope, re-run the visual pass on what changed, report the rest |

A calling command passes the mode and the task's file list. That list is the fix boundary; ask before
editing anything outside it.

## 2. Load context

**Skip any file already in context** (a calling command usually has the config,
rules, `browser.md`, `executor.md` and knowledge loaded). Otherwise read:

1. `.claude/zeross/config.json`:
   - `ui.designSystem` (`exists`, `paths`, `notes`), `ui.breakpoints`, `ui.darkMode`, `ui.i18n`
   - `project.apps[]` with `kind` `frontend`/`fullstack`: `path`, `stack`, `dev.url`. `stack` is only a hint:
     confirm the framework, router and styling approach from the app's manifest and files before mapping routes.
   - `rules.commentPolicy`, `rules.strictness`
2. Rule packs: auto-loaded by Claude Code from `.claude/rules/zeross/` (path-scoped packs load when you touch matching files). Read explicitly only what is not yet in context: `ui.md` (install-time UI answers and extra UI rules; treat every rule in it as a check), the `fe-*.md` packs and `custom.md`.
3. `.claude/zeross/knowledge/README.md`, then `auth-login.md` for login and any topic holding UI conventions.
4. `~/.claude/zeross/profile.json`: `capacity.playwright`, `capacity.understanding`, `executor`, and `mcpRoles.playwright` (the Playwright MCP server to use).
5. Workflow: `.claude/zeross/workflow/browser.md` (dev server, login, screenshots) and `.claude/zeross/workflow/executor.md` (parallelism).

If `config.json → ui` and `ui.md` disagree, use `config.json` for structured values
(breakpoints, flags, paths) and note the conflict in the report. `ui.md` is rendered
from `config.json → ui`; suggest `/zero-learn` (team config class) to change the
config and `zeross update apply` to re-render it.
If `ui.breakpoints` is missing, use 375×812, 768×1024, 1440×900.

References (load with `${CLAUDE_SKILL_DIR}/references/<file>`):

| Reference | Load when |
|---|---|
| `static-checklist.md` | Always (static pass) |
| `accessibility.md` | Always |
| `visual-checks.md` | Visual pass runs (viewports, sequence, lazy-load scroll, layout audit) |
| `visual-checks-extra.md` | Visual pass reaches contrast, keyboard focus, an interaction or dialog, layout shift, or dark mode |
| `responsive-patterns.md` | Any overflow/layout finding, or layout code changed |

## 3. Scope

Without arguments:

```bash
BASE=$(git merge-base HEAD "origin/<git.baseBranch>" 2>/dev/null || git merge-base HEAD "<git.baseBranch>")
git diff --name-only --diff-filter=ACMR "$BASE"
git ls-files --others --exclude-standard
```

Keep UI files inside frontend/fullstack app paths: `*.tsx`, `*.jsx`, `*.vue`, `*.svelte`, `*.astro`,
`*.css`, `*.scss`, `*.module.css`, `*.html`, `*.blade.php`, templates, Tailwind config, theme/token
files, i18n message files. Skip tests, stories (unless they are the change) and generated files.

**Map files to routes** (needed for the visual pass):

- Next.js App Router `app/**/page.tsx` → path (drop `(groups)`, keep `[param]`); Pages Router `pages/**`.
- Nuxt `pages/**`; SvelteKit `routes/**/+page.svelte`; React Router / Vue Router: grep the route config for the component.
- Shared components: grep importers up to 2 hops to find pages that render them; pick at most 3 representative routes per component.
- Dynamic segments: fill with real IDs from existing local data (per `browser.md`) or from `knowledge/`; if none is known, ask.
- If a component renders only behind an interaction (modal, drawer, tab), record the interaction needed to reach it.

## 4. Static pass (every touched component)

Read each file fully, plus the design-system components it uses or should use. Apply
`static-checklist.md` and `accessibility.md`. Cover:

1. **Design system**: tokens over hard-coded colors, spacing, radii, shadows, font sizes, z-index; existing components reused instead of near-duplicates (search `ui.designSystem.paths` before accepting a new Button/Modal/Input).
2. **States**: loading, empty, error, disabled (and pending submit), long content, zero/one/many, permission-denied.
3. **Responsive**: no fixed widths that break at the smallest breakpoint; flex/grid children can shrink (`min-w-0`, `minmax(0,1fr)`); long text wraps or truncates deliberately; tables/media contained.
4. **Accessibility**: semantic elements, labels, alt text, visible focus, keyboard path, contrast, ARIA only when needed, dialogs with focus management.
5. **Dark mode** (if `ui.darkMode`): every new color has a dark variant or comes from a themed token; images/illustrations readable on dark.
6. **i18n** (if `ui.i18n`): no hard-coded user-facing strings; no concatenated translations; room for ~40% text expansion; `Intl` formatting; logical CSS properties if RTL is supported.
7. **Custom rules**: every rule in `ui.md`, `custom.md` and the FE packs (e.g. no `any`, comment policy per `rules.commentPolicy`).
8. **Destructive actions**: every action that matches "Destructive actions" in `.claude/rules/zeross/core.md` has the confirmation that section defines (find them with `static-checklist.md` §4). A missing confirmation is a **Blocker**, unless the ticket, plan or user explicitly waived it.

Static findings without a visual symptom still get file:line and a fix.

## 5. Visual pass (Playwright MCP)

Preconditions, in order:

1. Resolve the Playwright MCP via `profile.json → mcpRoles.playwright`. If it is not connected, report "visual pass skipped: Playwright MCP unavailable" and continue with static results.
2. Dev server: check the app's `project.apps[].dev.url` (e.g. `curl -s -o /dev/null -w '%{http_code}' <url>`). If it is down, **ask the user to start it** (show `project.apps[].dev.command`). Never start a build.
3. Log in per `.claude/zeross/workflow/browser.md` using the fastest method in `knowledge/auth-login.md` and the account from `.claude/zeross/local.json` (`playwright.defaultEmail` / `playwright.accounts`). Never print passwords.

For each affected route × each breakpoint (`ui.breakpoints`), follow `visual-checks.md`:

1. Resize the viewport, then navigate (or navigate, then resize and reload). Wait for the page to settle (network idle or a key selector).
2. Screenshot the full page: filename `[<ticket>-]ui-<route-slug>-<breakpoint>[-<state>].png`, with `<ticket>` the lowercase ticket key as in `browser.md` (saved under `.playwright-mcp/`). Look at it: you are reviewing pixels, not just numbers.
3. Run the evaluate checks: horizontal overflow (`document.documentElement.scrollWidth > clientWidth`), elements overflowing the viewport, clipped or truncated text, overlapping or covered interactive elements, small touch targets (24×24 px per WCAG; 44×44 px at the smallest breakpoint when `.claude/rules/zeross/ui.md` requires it), broken images, layout shift.
4. Read console messages: errors and React/Vue warnings (hydration mismatch, key warnings) raised on this route.
5. If `ui.darkMode`: repeat steps 2–3 per route at the smallest and largest breakpoints with the dark color scheme emulated (or the app's theme toggle).
6. **Exercise one interaction per changed component** (open the modal, submit the form empty, expand the row). Screenshot the result and re-run the overflow/overlap checks if layout changed.
   **Destructive controls:** trigger one in the browser **only if** the static pass found a confirmation dialog on it **and** the target is dummy data logged per `.claude/zeross/workflow/data-safety.md`. Then open the dialog, inspect it, and cancel with Esc. Without a confirmation in the code, never click it: report the missing confirmation from the static pass.
7. **Keyboard**: at one breakpoint per route, Tab through the changed area (up to ~15 stops): focus order follows the visual order, focus is visible on every stop, no trap, dialogs move focus in and return it on close.

**Design comparison** (only when design references exist; see `.claude/zeross/workflow/tickets.md` →
"Design references"). A calling command passes them; when invoked directly, use what the user pasted or
linked, and ask for an exported image of any link you cannot open (no design-tool MCP is assumed).

- Pair each design with the screenshot of the same route, state and closest breakpoint.
- Compare: layout and hierarchy, component choice, spacing rhythm, typography scale, colors (map to
  tokens; do not copy raw hex from the design when a token exists), copy text, icons, and which states
  exist. Measure with evaluate checks (computed styles, element boxes) when a difference is borderline.
- Report each deviation as a finding with both images referenced. Severity: missing or wrong element,
  wrong copy, or broken layout → **Major**; off-scale spacing or a token mismatch → **Minor**; sub-pixel
  or anti-aliasing noise → ignore. A deviation that matches the design system while the design does not
  is a question for the user, not a defect.
- Design states that cannot be reproduced locally go under "Not checked".

**Parallelism**: run viewports/routes in parallel only up to `capacity.playwright`, and only with
isolated browser instances as described in `.claude/zeross/workflow/executor.md` (the shared
persistent profile must never be driven by two agents). Otherwise run serially. The static pass may
use read-only subagents up to `capacity.understanding`; verify their findings yourself.

## 6. Severity

| Severity | Rubric |
|---|---|
| **Blocker** | Task cannot be completed or content is unreachable at a configured breakpoint; page crash, blank render or console error that breaks the feature; destructive action without the required confirmation; keyboard trap or primary control unusable by keyboard/screen reader; essential image or content missing |
| **Major** | Missing loading/error/empty state; horizontal page scroll; clipped text without a way to read it; overlapping elements; body-text contrast below 4.5:1; focus not visible; wrong or duplicated component where a design-system one exists; dark mode or i18n broken where enabled; hydration error; primary action below 24×24 px, or below the `.claude/rules/zeross/ui.md` touch-target minimum on the smallest breakpoint |
| **Minor** | Hard-coded value equal to an existing token; spacing/alignment off the scale; secondary a11y issue (redundant ARIA, missing `autocomplete`); small layout shift; non-blocking console warning |
| **Nit** | Naming, class ordering, polish with no user impact |

## 7. Fixing

- `fix-blockers`: fix Blocker and Major findings within the task files, using existing tokens and components. Then **re-run the visual pass** for the affected routes and breakpoints and record before/after screenshots. Run related tests and lint only for changed files per `.claude/zeross/workflow/testing.md`.
- `report-only`: after the report, ask with `AskUserQuestion` (≤4 questions, recommended first): fix Blockers and Majors (Recommended), pick findings, or report only.
- Never commit, push, build, or run the whole test suite.

## 8. Output

```markdown
## UI review: <scope> (<n> files, <r> routes × <b> breakpoints)
**Verdict: <CHANGES REQUIRED | PASS WITH NOTES | PASS>** (<x> Blocker, <y> Major, <z> Minor, <w> Nit). Mode: <report-only | fix-blockers>
Visual pass: <done | skipped: reason>. Design comparison: <n designs | n/a>. Dark mode: <checked | n/a>. i18n: <checked | n/a>.

| # | Severity | Location | Viewport | Screenshot | Issue | Fix | Status |
|---|---|---|---|---|---|---|---|
| U1 | Blocker | src/app/orders/OrderRow.tsx:58 | all | — | "Delete order" deletes immediately, no confirmation | Wrap in the existing `ConfirmDialog` with title "Delete order #123?", buttons "Keep" / "Delete" | open |
| U2 | Major | src/app/orders/page.tsx:22 | mobile 375 | .playwright-mcp/proj-123-ui-orders-mobile.png | Table forces 612px width, page scrolls horizontally | Wrap table in `overflow-x-auto`, or card layout below `md` | fixed |

### Checked: no issues
- Design system, States, Responsive, Accessibility, Dark mode, i18n, Custom rules, Destructive actions: one line each on what was verified

### Not checked
- <anything skipped and why, e.g. route needs data that does not exist locally>
```

Verdict: **CHANGES REQUIRED** if any Blocker/Major is open; **PASS WITH NOTES** if only Minor/Nit remain;
**PASS** otherwise.

## 9. Never

- Report a visual issue you did not see in a screenshot or measure with an evaluate check.
- Start the dev server or a build yourself; ask the user.
- Use a non-local URL for the visual pass.
- Drive the shared browser profile from two agents at once.
- Click a destructive control that has no confirmation in the code, or one acting on anything but logged dummy data.
- Hard-code MCP server names; resolve via `profile.json → mcpRoles`.
- Edit files in `report-only` mode before the user chooses.
