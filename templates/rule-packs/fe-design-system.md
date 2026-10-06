# Design system rules

Applies to: frontend code in projects with a design system or component library (`ui.designSystem.exists` = true). Paths and notes are in `.claude/rules/zeross/ui.md`.

> Strictness follows `rules.strictness`.

## Before building UI

- Search the design system paths (`ui.designSystem.paths`) and Storybook, if any, for an existing component or variant **before** writing markup.
- Extend an existing primitive with a variant or prop rather than creating a near-duplicate (`PrimaryButton2`, `CustomModal`).
- If nothing fits, build the new piece from existing primitives and tokens, in the design system folder when it is reusable, and mention it in the report.
- Follow the composition patterns already in use: compound components, slots, `asChild`, `cva` variants, or similar.

## Tokens only

- **Colors:** use tokens, CSS variables or theme classes only. No hex, `rgb()`, `hsl()` or named colors in components.
- **Spacing, sizing, radius, shadow, z-index, typography:** use the scale only. No magic numbers (`mt-[13px]`, `padding: 7px`, `z-index: 9999`).
- **[strict]** Arbitrary values (Tailwind `[...]`, inline `style`) are allowed only for one-off measurements that the scale can't express, such as an aspect ratio or a third-party embed. Give the reason in the report.
- Breakpoints come from the theme or `ui.breakpoints`. Don't hard-code new media query widths.
- Animation durations and easings use tokens when they exist.
- Dark mode (`ui.darkMode`): use semantic tokens (`bg-surface`, `text-muted`), never raw palette steps that don't flip. Check both themes.

## Primitives

- Use the design system's Button, Input, Select, Dialog, Toast, Tooltip, Table and so on. Never use raw `<button class=…>` or hand-rolled modals when a primitive exists.
- Don't override primitive internals with deep selectors or `!important`. Use the exposed props, variants or `className` merge utility (`cn`, `clsx` + `tailwind-merge`).
- Icons come from the project's icon set, with consistent sizes from the scale.
- Feedback uses the project's existing patterns: its toast, inline error and confirm dialog, not ad-hoc alerts.

## Layout and responsiveness

- Build mobile-first, and check every breakpoint in `ui.breakpoints`.
- Use flex or grid with `gap`, not margins between siblings. Add `min-w-0` on flex children that contain text, and truncate or wrap long content.
- No fixed widths that break the smallest breakpoint, and no horizontal page overflow.
- Touch targets ≥ 44×44 px on mobile.

## Consistency

- Match the copy tone, capitalization (sentence vs title case), date and number formats, and empty-state style of neighboring screens.
- Use the same spacing rhythm and heading levels as sibling pages.
- New variants must work in every state: hover, focus-visible, active, disabled, loading, error.

## Review hooks

- `zero-ui-review` checks these rules statically, and visually at each breakpoint. Fix Blocker and Major findings before reporting done.
