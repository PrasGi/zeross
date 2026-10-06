# Accessibility: WCAG 2.2 AA essentials (practical)

Baseline is WCAG 2.2 AA. Check what the changed UI actually does; do not audit the whole app.
Native HTML first: a `<button>` beats `<div role="button" tabindex="0" onKeyDown=…>`. ARIA only when
no native element fits, and wrong ARIA is worse than none. Headless libraries (Radix, Headless UI,
React Aria, Reka/Radix Vue, Ark) handle most widget semantics: check they are used correctly rather
than re-implemented.

## Success criteria that matter most for component work

| SC | Level | Check | Typical fix |
|---|---|---|---|
| 1.1.1 Non-text content | A | Meaningful images have `alt`; decorative ones `alt=""`/`aria-hidden`; icon-only buttons have an accessible name | `aria-label` on icon button, `alt` text describing purpose |
| 1.3.1 Info and relationships | A | Headings are `h1–h6` in order; lists are `ul/ol`; tables use `th` + `scope`; form fields have `<label for>`; groups use `fieldset/legend` | Semantic elements instead of styled `div`s |
| 1.3.5 Identify input purpose | AA | `autocomplete` on personal-data inputs | `autocomplete="email"`, `"tel"`, `"name"`, `"one-time-code"` |
| 1.4.1 Use of color | A | Color is not the only signal (errors, status, links in text) | Icon/text + color; underline links in body text |
| 1.4.3 Contrast (minimum) | AA | Text ≥ 4.5:1; large text (≥ 24px, or ≥ 18.66px bold) ≥ 3:1 | Darker token; avoid gray-400 on white |
| 1.4.4 Resize text | AA | Usable at 200% zoom | Relative units, no fixed-height text containers |
| 1.4.10 Reflow | AA | No 2-D scrolling at 320 CSS px width (except data tables, maps) | See `responsive-patterns.md` |
| 1.4.11 Non-text contrast | AA | Input borders, focus rings, icons that convey meaning ≥ 3:1 | Stronger border token |
| 1.4.12 Text spacing | AA | No clipping when line/letter/word spacing increased | Avoid fixed heights on text boxes |
| 1.4.13 Content on hover/focus | AA | Tooltips/popovers dismissible (Esc), hoverable, persistent | Library tooltip; no tooltips with essential info only on hover |
| 2.1.1 Keyboard | A | Every action works with keyboard | Native controls; key handlers for custom widgets |
| 2.1.2 No keyboard trap | A | Focus can always leave (except modal dialogs, which must close with Esc) | Fix focus-trap scope |
| 2.4.3 Focus order | A | Order follows reading/visual order; no positive `tabindex` | DOM order = visual order; avoid CSS `order` reshuffles of controls |
| 2.4.4 Link purpose | A | Link text meaningful in context (no bare "click here" without context) | Descriptive text or `aria-label` |
| 2.4.6 Headings and labels | AA | Headings/labels describe purpose | Copy fix |
| 2.4.7 Focus visible | AA | Visible focus indicator on every focusable element | `focus-visible:ring-*`; never `outline-none` without a replacement |
| 2.4.11 Focus not obscured (min) | AA (new) | Focused element not fully hidden by sticky headers/footers, cookie banners | `scroll-padding-top`/`scroll-margin`, avoid overlapping fixed bars |
| 2.5.3 Label in name | A | Accessible name contains the visible label text | Do not override visible "Save" with `aria-label="Submit form"` |
| 2.5.7 Dragging movements | AA (new) | Drag-and-drop has a single-pointer alternative (buttons, menus) | "Move up/down" actions, select + move |
| 2.5.8 Target size (min) | AA (new) | Pointer targets ≥ 24×24 CSS px, or spaced so a 24px circle doesn't overlap neighbors; inline text links exempt | Padding/min-size on icon buttons |
| 3.2.1/3.2.2 On focus / on input | A | Focusing or changing a field does not trigger navigation/submit unexpectedly | Explicit submit |
| 3.3.1 Error identification | A | Errors identified in text, tied to the field | `aria-describedby` + `aria-invalid` |
| 3.3.2 Labels or instructions | A | Visible labels; format hints (date format, password rules) | Label + hint text |
| 3.3.3 Error suggestion | AA | Error says how to fix | "Use at least 12 characters" |
| 3.3.7 Redundant entry | A (new) | Info already given in the flow is pre-filled or selectable | Prefill from earlier steps |
| 3.3.8 Accessible authentication (min) | AA (new) | No cognitive test to log in; paste allowed in password/OTP fields; password managers work | Do not block paste; `autocomplete` on credentials |
| 4.1.2 Name, role, value | A | Custom controls expose role, name, state (`aria-expanded`, `aria-pressed`, `aria-checked`, `aria-selected`) | Native element or correct ARIA pattern |
| 4.1.3 Status messages | AA | Toasts, async results, form-level errors announced without focus move | `role="status"` (polite) / `role="alert"` (urgent) / `aria-live` region present before update |

(4.1.1 Parsing was removed in WCAG 2.2.)

## Component patterns

**Buttons vs links**: navigation → `<a href>`/framework `Link`; actions → `<button type="button">`
(or `type="submit"` in forms). Clickable `div`/`span`/`img`: Major (Blocker for primary actions).

**Icon-only buttons**: accessible name via `aria-label` or visually hidden text; icon `aria-hidden="true"`.

**Dialogs / modals / drawers**
- `role="dialog"` (or `alertdialog` for confirmations) + `aria-modal="true"`, labelled by its title (`aria-labelledby`), described by its message (`aria-describedby`), or native `<dialog>` with `showModal()`.
- Focus moves into the dialog on open (first safe control or the dialog), is trapped while open, returns to the trigger on close.
- Esc closes; background is inert (`inert` / `aria-hidden` on siblings, handled by libraries); scroll locked.
- Destructive confirmations: see `static-checklist.md` §4.

**Menus, selects, comboboxes, tabs, accordions**: use the library component or follow the WAI-ARIA
APG pattern (arrow-key navigation, `aria-expanded`, `aria-controls`, `aria-selected`, roving
`tabindex`). A custom select made of `div`s without keyboard support: Major.

**Forms**
- `<label for>`/wrapping label for every input; placeholder is not a label.
- Errors: text near the field, `aria-describedby` → error id, `aria-invalid="true"`; on submit, focus the first invalid field or an error summary.
- Required: `required`/`aria-required` plus a visible marker explained once.
- Groups of radios/checkboxes in `fieldset` + `legend`.

**Images and media**: `alt` per purpose (not filename); complex charts get a text summary; video
has captions; no autoplaying audio; animations respect `prefers-reduced-motion`.

**Tables**: `<table>` with `<th scope>`; caption or `aria-label`; sortable headers are buttons with
`aria-sort`.

**Live updates**: toasts in a persistent `role="status"` region; loading states announced
(`aria-busy` on the region or a status message); avoid announcing every keystroke.

**Page level** (only if touched): one `h1`, `lang` on `<html>`, unique `<title>` per route, skip link,
landmarks (`header`, `nav`, `main`, `footer`).

## Quick checks during the visual pass

- Accessibility snapshot from the Playwright MCP: every interactive element has a role and a name; no `generic` clickable nodes; headings in order.
- Tab walk (`visual-checks-extra.md` §6): visible focus, logical order, no trap, not obscured.
- Contrast snippet (`visual-checks-extra.md` §5).
- Zoom/reflow: the smallest configured breakpoint (≥ 320 px) has no horizontal scroll.

## Severity mapping

Blocker: keyboard trap; primary control unreachable by keyboard or without a name; dialog that
cannot be closed with keyboard. Major: missing labels/alt on meaningful content, focus not visible,
body-text contrast failure, custom widget without keyboard support, errors not associated.
Minor: redundant/incorrect non-critical ARIA, missing `autocomplete`, small secondary targets,
heading level skips. Nit: wording of accessible names.
