<!--
zeross template: ui.md

UI review configuration, captured in the /zeross install interview (batch C).
It is read by zero-ui-review and by every command that touches UI. Installed at
.claude/rules/zeross/ui.md. The source of truth is .claude/zeross/config.json → ui
(including ui.extraRules for the free-text UI rules); this file is rendered from it.

Placeholders filled by the installer:
  {{designSystemStatus}}  "Yes" or "No"
  {{designSystemPaths}}   Markdown bullets of paths (components, tokens, Storybook),
                          or "- _None_"
  {{designSystemNotes}}   free-text notes (library name, theming approach), or "_None_"
  {{breakpoints}}         Markdown bullets "name: WIDTHxHEIGHT", default
                          mobile 375x812, tablet 768x1024, desktop 1440x900
  {{darkMode}}            "Yes" or "No"
  {{i18n}}                "Yes" or "No", plus locales and the i18n library when known
  {{extraUiRules}}        Markdown bullets of extra UI rules, or "- _None_"

Maintenance: `zeross update apply` re-renders this file from config.json → ui, so
never hand-edit it. Change config.json ui.* instead (/zero-learn, "team config"
class), then re-render. English only.
-->
# UI rules

Applies to: every UI change in frontend apps. Read with `fe-core.md` and, when present, `fe-design-system.md`.

## Design system

- Design system in use: {{designSystemStatus}}
- Paths:
{{designSystemPaths}}
- Notes: {{designSystemNotes}}
- Reuse components and tokens from these paths before writing new markup or styles.

## Viewports

Check every UI change at each of these breakpoints:

{{breakpoints}}

- No horizontal overflow (`scrollWidth > clientWidth`) at any breakpoint.
- No clipped or overlapping elements, and touch targets ≥ 44×44 px on the smallest breakpoint.

## Themes and locales

- Dark mode: {{darkMode}}. When it is on, check both themes and use semantic tokens only.
- i18n: {{i18n}}. When it is on, user-facing strings come from i18n keys in every maintained locale, with layouts tolerating ~40% text expansion.
- RTL: when the locales include a right-to-left language, check mirrored layout and logical CSS properties (`margin-inline-start`, not `margin-left`).

## Required checks for every touched component

- States: loading, empty, error, disabled, and long content.
- Accessibility: semantic elements, labels, alt text, visible focus, keyboard path, contrast ≥ 4.5:1 (text) and ≥ 3:1 (UI).
- No console errors or failed requests on the affected routes.
- Destructive actions follow "Destructive actions" in `core.md`.

## Extra UI rules

{{extraUiRules}}
