# Vue and Nuxt rules

Applies to: Vue 3 apps, including Nuxt 3+ and Vite + Vue.

> Strictness follows `rules.strictness`; comments follow `rules.commentPolicy` (JSDoc/TSDoc in `<script setup>`); tests follow `rules.testPolicy`.

## Components

- Use `<script setup lang="ts">` and the Composition API for new code. Match the Options API only inside existing Options API files.
- Type props with `defineProps<{…}>()` and `withDefaults`, and emits with `defineEmits<{…}>()`. Use **no `any`**.
- **Never mutate props.** Emit an event, or use `defineModel` for two-way binding.
- **[strict]** Keep single-file components small, roughly ≤ 200 lines including the template. Extract composables (`useX`) for logic and child components for template sections.
- Use `computed` for derived state, never a `watch` that copies values into a `ref`.
- Use `watch` and `watchEffect` only for side effects. Clean up with `onWatcherCleanup` or `onScopeDispose`. Avoid `deep: true` on large objects.
- `v-for` always has a stable `:key`. Never put `v-if` and `v-for` on the same element.
- Use slots and props for composition, and `provide`/`inject` (typed with `InjectionKey`) instead of deep prop drilling.

## Reactivity pitfalls

- Destructuring `reactive()` or props loses reactivity. Use `toRefs`, or access `props.x` directly. Vue 3.5+ props destructure is fine when the project uses it.
- Use `shallowRef` for large immutable data or third-party instances. Never make class instances from libraries deeply reactive.
- Never keep a reactive object across requests in a module scope on the server. That is SSR state pollution.

## Nuxt data fetching

- Use `useFetch` or `useAsyncData` for SSR-safe data. Use `$fetch` only in event handlers or server code.
- Give `useAsyncData` a unique key. Handle `pending`, `error` and empty `data` in the template.
- Use `useState` for SSR-safe shared state, never a module-level `ref`.
- After a mutation, call `refresh()` or `refreshNuxtData(key)` for exactly what changed.
- Route params and query: read them through `useRoute()`, and validate them before use.

## Nuxt server (`server/api`, `server/routes`)

- Treat every handler as a public endpoint: authenticate, authorize the resource, and validate the body, query and params (`readValidatedBody` or `getValidatedQuery` with the project's schema library).
- Throw `createError({ statusCode, statusMessage })` with a consistent shape. Never return raw errors.
- Keep secrets in `runtimeConfig` (server-only keys). Only `runtimeConfig.public` reaches the client.
- Put shared server utilities in `server/utils`, and keep DB access out of components and pages.

## Templates and security

- Never use `v-html` with untrusted content unless it goes through the project's sanitizer first.
- Bind URLs safely, and validate external or user-supplied hrefs (no `javascript:`).
- Use `<NuxtLink>` for internal navigation and `<NuxtImg>`/`<NuxtPicture>` when `@nuxt/image` is installed.

## State

- Use Pinia for shared client state, with setup stores in new code. Keep server data in `useFetch`/`useAsyncData` or the project's query layer, not duplicated in Pinia (see `fe-state.md`).
- Use `storeToRefs` when destructuring a store.

## Testing

- Vitest with `@vue/test-utils` or `@testing-library/vue`, and `@nuxt/test-utils` for Nuxt-aware components (`mountSuspended`).
- Assert rendered output and emitted events (`wrapper.emitted()`), not internal refs.
- Mock `$fetch` or the network at the boundary. Test server handlers for valid input, invalid input, unauthenticated and forbidden.
