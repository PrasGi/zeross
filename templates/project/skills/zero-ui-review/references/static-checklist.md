# Static checklist (every touched component)

Read the component, its styles, the design-system components it uses, and one existing similar
screen for comparison. Each finding needs file:line and a fix in the project's own vocabulary.

## 1. Design system

Find the system first: `config.json → ui.designSystem.paths`, `.claude/rules/zeross/ui.md` notes, Tailwind
config/theme (`tailwind.config.*`, `@theme` in CSS for Tailwind v4), CSS variables files
(`tokens.css`, `globals.css`, `theme.ts`), component library (`components/ui/*` for shadcn,
MUI/Chakra/Mantine/Ant themes, Vuetify/PrimeVue/Nuxt UI), Storybook.

Hard-coded values (grep the changed files):

```bash
grep -nE "#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(" <files>                     # raw colors
grep -nE "\b(bg|text|border|ring|fill|stroke|from|to|via)-\[[^]]+\]" <files>       # Tailwind arbitrary colors
grep -nE "\b(p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|space-[xy]|w|h|min-w|max-w|top|left|right|bottom|rounded|text)-\[[0-9.]+(px|rem)?\]" <files>
grep -nE "style=\{\{|:style=|style=\"" <files>                                     # inline styles
grep -nE "z-index:\s*[0-9]{3,}|z-\[[0-9]+\]|!important" <files>
```

- [ ] Colors, spacing, radii, shadows, font sizes/weights, z-index and breakpoints come from tokens/theme scale. A hard-coded value that equals an existing token is Minor; one that diverges visually from the system is Major.
- [ ] Semantic tokens over palette tokens where the system has them (`bg-destructive`, `text-muted-foreground`, `color.text.subtle`) so dark mode and theming work.
- [ ] Existing components reused: before accepting a new `Button`, `Modal`/`Dialog`, `Input`, `Select`, `Dropdown`, `Tooltip`, `Badge`, `Card`, `Table`, `Tabs`, `Toast`, `Skeleton`, `EmptyState`, `ConfirmDialog`, search the design-system paths and `components/` for one. A near-duplicate is Major (diverging behavior and a11y).
- [ ] Component variants used instead of overriding styles (`<Button variant="destructive">`, not `className="bg-red-600"`).
- [ ] Icons from the project's icon set, consistent size tokens; decorative icons `aria-hidden`.
- [ ] Typography via the text components/classes the project uses, heading levels semantic (not chosen for size).

## 2. States

For each data-driven view or async action, find the code path for every state:

| State | What to look for |
|---|---|
| Loading | Skeleton/spinner matching final layout size; React Query/SWR `isLoading`/`isPending`, Next.js `loading.tsx` / `<Suspense fallback>`, Nuxt `pending` / `status === 'pending'` |
| Empty | Zero items handled with an explanation and a next action, not a blank area or an empty table header |
| Error | `isError`/`error`, Next.js `error.tsx`/`not-found.tsx`, Nuxt `error`; message in user terms plus retry; no raw `error.message` from the server |
| Disabled / pending | Submit disabled while pending (prevents double submit), disabled controls explain why when non-obvious |
| Long content | Long names, emails, URLs, numbers, translated strings: wrap (`break-words`, `overflow-wrap:anywhere`) or truncate with full text available (`title`/tooltip) |
| Many items | Pagination/virtualization; layout survives 100+ items |
| Zero/one/many | Pluralization (`Intl.PluralRules` / i18n plural keys), not `item(s)` |
| Permission | Unauthorized/forbidden state when a role cannot see or act |
| Partial data | Optional fields missing (no `undefined`, `null`, `NaN`, `Invalid Date` rendered) |

## 3. Forms

- [ ] Every field has a visible label (placeholder is not a label); required fields marked.
- [ ] Validation errors inline, next to the field, linked via `aria-describedby`, `aria-invalid` set; form-level summary for long forms; focus moves to the first error on submit.
- [ ] Input preserved on error; server errors shown; success feedback.
- [ ] Correct input types and `autocomplete` (`email`, `tel`, `current-password`, `new-password`, `one-time-code`), `inputmode` for numeric.
- [ ] Schema shared with the backend if the project does that (`fe-forms` pack).
- [ ] Leaving a form with unsaved input follows "Destructive actions" in `.claude/rules/zeross/core.md` (see §4 below).

## 4. Destructive actions

Find them: `delete`, `remove`, `archive`, `discard`, `reset`, `revoke`, `cancel subscription`,
`leave`, `publish`, `send`, `pay`, `transfer`, bulk actions, "regenerate"/"replace" over existing
content, closing a dirty form/wizard.

```bash
grep -niE "delete|remove|archive|discard|revoke|destroy|reset|publish|unpublish|transfer|regenerate|overwrite|bulk" <files>
```

- [ ] Each one has the confirmation defined in "Destructive actions" in `.claude/rules/zeross/core.md` (the canonical rule: what counts, the visible-undo exception, title, what is lost, labels, styling and default, Esc/backdrop, reused dialog, shared copy constant). Check every item of that list against the code.

Missing confirmation: Blocker unless the ticket/plan/user explicitly waived it.

## 5. Responsive (static)

See `responsive-patterns.md` for fixes.

- [ ] No fixed widths/heights on containers that can exceed the smallest breakpoint (`w-[600px]`, `width: 600px`, `min-width` on cards); use `w-full max-w-*`.
- [ ] Flex children with text: `min-w-0` (or `overflow-hidden`) so they can shrink; grid columns `minmax(0, 1fr)`.
- [ ] Mobile-first: base classes for mobile, `sm:`/`md:`/`lg:` for larger. Multi-column grids (`grid-cols-3`) without a mobile base are suspicious.
- [ ] Tables have a mobile strategy (scroll container or card layout).
- [ ] `100vh` → `100dvh`/`min-h-dvh` for full-height mobile layouts; `w-screen` → `w-full`.
- [ ] Hover-only affordances have a touch/keyboard equivalent.

## 6. Accessibility (static)

Apply `accessibility.md`. Frequent code smells:

```bash
grep -nE "<(div|span|li|td|tr|img)[^>]*(onClick|@click|v-on:click)" <files>         # clickable non-buttons
grep -nE "<(img|Image|NuxtImg)\b" <files> | grep -v "alt="                          # images without alt (single-line tags)
grep -nE "outline-none|outline:\s*none|focus:outline-none" <files>                  # focus removed (needs a replacement ring)
grep -nE "tabIndex=\{?[1-9]|tabindex=\"[1-9]" <files>                               # positive tabindex
grep -nE "aria-[a-z]+=" <files>                                                   # review each ARIA use
```

## 7. Dark mode (only if `ui.darkMode`)

- [ ] New colors via themed tokens/CSS variables, or every light color has a `dark:` counterpart.
- [ ] Hard-coded `bg-white`, `text-black`, `text-gray-900`, `border-gray-200`, raw hex without dark variants.
- [ ] Images/illustrations/logos have dark variants or transparent backgrounds that work on dark.
- [ ] Shadows replaced/supplemented by borders where shadows vanish on dark.

## 8. i18n (only if `ui.i18n`)

- [ ] No hard-coded user-facing strings in JSX/templates/attributes (`placeholder`, `aria-label`, `title`, `alt`, toast messages, validation messages); use the project's `t()` / `$t()` / `<Trans>` / `useTranslations`.
- [ ] No string concatenation of translated fragments; use interpolation and ICU plurals.
- [ ] Dates, numbers, currency via `Intl`/the i18n library with the active locale.
- [ ] Layout tolerates ~40% text expansion (per `.claude/rules/zeross/ui.md`; German/Indonesian/Finnish); no fixed-width buttons with text.
- [ ] RTL (if supported): logical properties (`ms-`/`me-`/`ps-`/`pe-`, `start`/`end`, `margin-inline-start`), mirrored directional icons.
- [ ] New keys added to every locale file (or the fallback policy is explicit).

## 9. Framework hints

**React / Next.js**
- [ ] `'use client'` only where needed; no server-only imports in client components.
- [ ] Stable `key` (not array index for reorderable lists).
- [ ] Effects: no data fetching that should be server-side; cleanup present; no state derived via effect when it can be computed.
- [ ] `next/image` with `width`/`height` or `fill` + sized parent + `sizes` (prevents CLS); `alt` present; `priority` only for the LCP image.
- [ ] `next/link` for internal navigation; `next/font` for fonts (no layout shift).
- [ ] Hydration safety: no `Date.now()`/`Math.random()`/`window` reads during render that differ server vs client.
- [ ] `dangerouslySetInnerHTML`: flag for `/zero-security-review`.

**Vue / Nuxt**
- [ ] `v-for` with `:key`; no `v-if` with `v-for` on the same element.
- [ ] Props typed (`defineProps<…>()`), emits declared.
- [ ] `<NuxtLink>`, `<NuxtImg>`/`<img>` with dimensions; `useFetch`/`useAsyncData` states handled.
- [ ] `<style scoped>` or modules; no global leaks. `v-html`: flag for security review.

**Tailwind**
- [ ] Class order/lint per the project's Prettier plugin; no conflicting utilities (`p-2 p-4`).
- [ ] Arbitrary values only when no scale value fits, and repeated ones moved to the theme.
- [ ] Use `cn()`/`clsx`/`tailwind-merge` helper the project uses for conditional classes.
- [ ] Dynamic class names are complete strings (Tailwind cannot see `bg-${color}-500`).

**CSS Modules / SCSS**
- [ ] Variables/mixins from the token files, not literals; no `:global` leaks; no deep nesting that fights the component library.
- [ ] Units: `rem` for type and spacing per project convention; no `px` font sizes if the project avoids them.
- [ ] z-index from a shared scale.

## 10. Custom and pack rules

- [ ] Every rule in `.claude/rules/zeross/ui.md`, `custom.md` and `fe-*.md` packs checked, e.g. no `any`, typed props, comment policy (`rules.commentPolicy`: `none` | `exported` | `every-component`), file/component size limits, test policy for components.
- [ ] Rule violations: severity by user impact; pure convention → Minor/Nit.
