# Frontend core rules

Applies to: every frontend app (`project.apps[].kind` = `frontend` or `fullstack`), whatever the framework.

> Strictness follows `rules.strictness`; comments follow `rules.commentPolicy`; tests follow `rules.testPolicy` (see `core.md`).

## Types and props

- Type every prop, event payload and API response. Use **no `any`**: use `unknown` and narrow it, or model the type.
- **[strict]** No non-null assertions (`!`), `as` casts or `@ts-ignore`/`@ts-expect-error` without a one-line reason. Prefer `satisfies` for typed literals.
- Derive API types from the source of truth: generated OpenAPI or GraphQL types, shared schema packages, or zod `infer`. Never hand-copy backend types.
- Keep props minimal and explicit. Don't spread unknown props onto DOM nodes. Use discriminated unions for variant props instead of many booleans.

## Components

- One component per file, named like the file. Follow the app's folder convention.
- **[strict]** Keep components small and focused, roughly ≤ 150 lines. Extract sub-components and hooks when a component mixes data fetching, state logic and layout.
- Keep state in the lowest component that needs it. Lift it only when siblings share it. Don't prop-drill more than 2 levels; use composition (children or slots) or context.
- Derive values during render instead of syncing them into state.
- Stable, unique keys for lists, never the array index unless the list is static and never reordered.
- Reuse existing components, hooks and utils before writing new ones (see `fe-design-system.md` when present).

## Required UI states

Every view that loads or mutates data handles all of these:

- **Loading:** a skeleton or spinner that keeps the layout stable, with no layout shift when data arrives.
- **Empty:** a meaningful message and the next action, never a blank area.
- **Error:** a user-facing message, a retry when sensible, and no raw error or stack trace shown.
- **Disabled and pending:** buttons disabled during submit, with no double-submit.
- **Long content:** truncation or wrapping (`min-w-0`, `overflow-wrap`), with no horizontal page overflow.
- **Permission:** hide or disable actions the user can't perform, *and* rely on the server to enforce it.

## Accessibility baseline

- Use semantic elements first: `<button>` for actions, `<a href>` for navigation, real `<label>` for inputs, landmarks, and headings in order.
- Everything interactive is reachable by keyboard, has a visible focus style, and has a logical tab order. Modals trap focus and restore it on close.
- Images need `alt`; decorative ones use `alt=""`. Icon-only buttons need `aria-label`.
- Use ARIA only when semantics can't express it. Never override implicit roles.
- Contrast: ≥ 4.5:1 for text, ≥ 3:1 for UI components. Never convey meaning by color alone.
- Respect `prefers-reduced-motion` for non-essential animation.

## Security in the client

- **No secrets in the client bundle.** Only intentionally public values go in public env vars (`NEXT_PUBLIC_*`, `VITE_*`, `NUXT_PUBLIC_*`).
- Never render untrusted HTML (`dangerouslySetInnerHTML`, `v-html`, `innerHTML`) without sanitizing it with the project's sanitizer.
- Validate redirect targets against an allowlist. Reject `javascript:` URLs. Check the `origin` on `postMessage`.
- Don't keep auth tokens in `localStorage` when the project uses httpOnly cookies. Don't log tokens or PII to the console.
- Client validation is UX only. The server must validate again.

## i18n

- When `ui.i18n` is true: no hard-coded user-facing strings. Use the project's i18n keys and add them to every locale file the project maintains, or mark them for translation the way the project does.
- Format dates, numbers and currency with the locale-aware formatter. Plan for ~30–40% text expansion. Support RTL if the project does.

## Network and performance

- Cancel or ignore stale requests: `AbortController`, or the query library's cancellation. Avoid request waterfalls and fetch in parallel.
- Lazy-load heavy, below-the-fold components and routes. Don't add a large dependency for a small feature.
- Images need explicit dimensions and lazy loading below the fold.
- Clean up subscriptions, timers and listeners on unmount.

## Testing

- Use Testing Library (or the framework equivalent): render, interact with `userEvent`, and assert what the user sees.
- Query by role, label or text. Mock the network at the boundary (MSW or the project's mocks), not the component's hooks.
- For each changed component, test the required UI states that apply (loading, empty, error) and the main interaction.
