# React and Next.js rules

Applies to: React apps, including Next.js (App Router or Pages Router), Vite + React and Remix-style apps.

> Strictness follows `rules.strictness`; comments follow `rules.commentPolicy` (JSDoc/TSDoc); tests follow `rules.testPolicy`.

## Server and client boundary (Next.js App Router)

- Components are **Server Components by default**. Add `'use client'` only for state, effects, browser APIs or event handlers, at the smallest leaf that needs it.
- Never import server-only code (DB clients, secrets, `fs`, server SDKs) into client components. Mark server modules with `import 'server-only'` when the project uses it.
- Props crossing the boundary must be serializable. No functions (except Server Actions), class instances or Dates unless the project handles them.
- Pass server data down as props instead of re-fetching it on the client.
- Keep `'use client'` files free of data-access logic. They receive data, they don't query it.

## Data fetching and caching

- Fetch in Server Components or route loaders, not in `useEffect`.
- Client-side server state uses the project's server-state library (TanStack Query or SWR). See `fe-state.md`.
- Be explicit about caching on every fetch:
  - `cache: 'no-store'`, `next: { revalidate }`, or `next: { tags }` per the project's convention
  - for pages that read cookies, headers or search params, know what dynamic rendering means for them
- After a mutation, revalidate exactly what changed (`revalidateTag`, `revalidatePath`, or query invalidation). Never rely on a full reload.
- Run independent awaits in parallel (`Promise.all`). Avoid sequential waterfalls in layouts and pages.
- Use `loading.tsx`, `error.tsx` and `not-found.tsx` (or Suspense and error boundaries) for route-level states.

## Server Actions and route handlers

- Treat every Server Action and route handler as a **public endpoint**:
  - authenticate
  - authorize the specific resource
  - validate input with the project's schema library (zod etc.) before use
- Return typed results (`{ ok: true, data } | { ok: false, error }`) or the project's action wrapper. Never leak stack traces or raw DB errors.
- Use the project's existing action or handler wrapper (auth, logging, error mapping) when one exists.
- Set correct HTTP status codes in route handlers and a consistent error shape.

## Hooks and effects

- Follow the Rules of Hooks. Satisfy `react-hooks/exhaustive-deps`. Never silence it without a reason.
- **Effects are for syncing with external systems only.** Don't use them for:
  - derived state (compute it in render)
  - event responses (put them in handlers)
  - data fetching that the framework or query library can do
- Every effect that subscribes, sets a timer or adds a listener returns a cleanup. Guard async effects against setting state after unmount (an abort or ignore flag).
- Extract reusable stateful logic into `use*` hooks. Keep hooks pure of JSX.

## Rendering and performance

- Keys must be stable and unique. Never `Math.random()`, and never the index for dynamic lists.
- **[strict]** Use `memo`, `useMemo` and `useCallback` only for a measured problem, or where referential stability is required (a dependency of a memoized child or an effect). Don't wrap everything.
- Avoid creating context values inline without memoizing them when many consumers re-render.
- Split large client bundles with `next/dynamic` or `React.lazy` and Suspense.
- Images use `next/image` with `width`/`height` or `fill` plus `sizes`, and `priority` only for the LCP image. Fonts use `next/font`.
- Use `<Link>` for internal navigation. Never call `router.push` in render.

## Metadata, routing and config

- Pages export `metadata` or `generateMetadata` per the project's convention.
- Read URL state through `useSearchParams` and `params`, and validate it before use.
- Env vars: server-only ones carry no `NEXT_PUBLIC_` prefix. Never read `process.env` secrets in client files.
- Middleware stays light: auth redirects and headers only. No heavy DB work.

## Testing

- Component tests with Testing Library and `userEvent`. Mock `next/navigation` with the project's existing helpers.
- Test Server Actions and route handlers as functions: valid input, invalid input (422/400), unauthenticated, forbidden.
- Test hooks with `renderHook` and a real QueryClient or provider wrapper from the project's test utils.
