# Frontend state rules

Applies to: state management in frontend apps (React, Vue, other).

> Strictness follows `rules.strictness`.

## Choose the right home for state

| Kind of state | Home |
|---|---|
| Server data (fetched, cached, shared) | the server-state library: TanStack Query, SWR, Apollo/urql, Nuxt `useAsyncData`, or framework loaders |
| URL-shareable UI state (filters, sort, page, tab, selected id) | the URL: search params or route params |
| Form state | the form library (`fe-forms.md`) |
| Local UI state (open/closed, hover, input draft) | component state (`useState` / `ref`) |
| Cross-cutting client state (auth session snapshot, theme, cart, wizard) | the project's client store (Zustand, Redux Toolkit, Jotai, Pinia) or context |

- **Never copy server data into a client store** to "cache" it. Use the server-state library's cache.
- Use the libraries the project already has. Don't add a second store or query library.

## Server state

- Build query keys from a central key factory when the project has one. Keys include every input that changes the result: ids, filters, locale, tenant.
- Set `staleTime` deliberately to match the project's defaults. Don't refetch on every focus for data that rarely changes.
- After a mutation, invalidate or update exactly the affected keys. Optimistic updates need `onMutate` with a snapshot, a rollback in `onError`, and a refetch in `onSettled`.
- Handle `isPending`, `isError` and empty data in the UI (`fe-core.md` states). Don't render `data!`.
- Dependent queries use `enabled`. Paginated or infinite lists use the library's pagination helpers.
- On logout or tenant switch, clear the cache (`queryClient.clear()` or the equivalent) so data never leaks between users.

## Client stores

- Keep stores small and domain-scoped (`useCartStore`, `useUiStore`). No god-store.
- Select narrowly (`useStore(s => s.count)`) to avoid re-rendering on unrelated changes. Use `storeToRefs` in Pinia.
- Keep state serializable where persisted or devtools-inspected. No class instances, DOM nodes or functions in persisted state.
- Put actions, not components, in charge of state transitions. Keep business invariants in one place.
- **[strict]** Persist only what is needed (`persist` middleware with an explicit allowlist). **Never persist tokens, PII or secrets** to `localStorage`.
- Reset per-user stores on logout.

## Context

- Use context for stable, low-frequency values: theme, locale, current user, feature flags.
- Split contexts by update frequency, and memoize provider values. Don't use context as a high-frequency store.

## URL state

- Parse and validate search params with a schema, with defaults for missing or invalid values.
- Use `replace` for filter tweaks, and `push` only for navigation the user expects to go back to.
- Keep URLs readable, and never put secrets or PII in them.

## Derived state

- Compute it in render or selectors (`computed`, memoized selectors). Never store a value that can be derived from other state.

## Testing

- Test stores and selectors as plain logic: initial state, each action, reset.
- Test components with a fresh store or QueryClient per test, from the project's test utils. Never share a cache between tests.
- Mock the network, not the query hooks.
