# Responsive breakage patterns and fixes

Use this to find the source of an overflow/layout finding and to propose the fix. Tailwind classes
are shown first, plain CSS in parentheses. Default Tailwind breakpoints: `sm` 640, `md` 768,
`lg` 1024, `xl` 1280, `2xl` 1536 (min-width, inclusive); check the project's theme for overrides.

## Horizontal overflow (page scrolls sideways)

| Cause | How to spot | Fix |
|---|---|---|
| Fixed width wider than the viewport | `w-[600px]`, `width: 600px`, `min-w-[…]` on a card/form/modal | `w-full max-w-[600px]` (`width:100%; max-width:600px`) |
| `100vw` / `w-screen` | Desktop with a vertical scrollbar: 100vw includes the scrollbar → ~15px overflow | `w-full` (`width:100%`) |
| Flex child cannot shrink | Long text/URL/code in a flex item pushes siblings out; flex items default to `min-width: auto` | `min-w-0` on the flex child (+ `truncate` or `break-words` on the text) |
| Grid track min-content | `grid-cols-[1fr_auto]` with long content; `1fr` = `minmax(auto, 1fr)` | `grid-cols-[minmax(0,1fr)_auto]`, or `min-w-0` on the grid item |
| Non-responsive grid | `grid-cols-3` with no mobile base | `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` |
| Long unbroken strings | Emails, URLs, IDs, hashes, German compounds | `break-words` / `[overflow-wrap:anywhere]` (`overflow-wrap:anywhere`), or `truncate` with a `title` |
| Tables | Many columns at 375 px | Wrap in `overflow-x-auto` container (scroll only the table), or switch to a stacked card layout below `md` |
| Images/video/iframes/embeds | Intrinsic width larger than the container | `max-w-full h-auto` (`max-width:100%; height:auto`); iframes `w-full aspect-video` |
| Negative margins / full-bleed hacks | `-mx-*` without matching parent padding | Match parent padding, or use `overflow-x-clip` on the section wrapper |
| Absolutely positioned decorations | Blobs/illustrations positioned outside the container | `overflow-x-clip` (prefer `clip` over `hidden` so sticky children still work) on the wrapper |
| `whitespace-nowrap` rows | Button groups, tags, breadcrumbs, tabs | `flex-wrap gap-2`, horizontal scroll container for tabs (`overflow-x-auto` + `snap-x`), or collapse into a menu |
| Code blocks / `pre` | Long lines | `overflow-x-auto` on `pre`, never on the page |
| Transforms off-screen | `translate-x-full` drawers not hidden | Hide when closed (`invisible`/`hidden`/`inert`), or clip the container |

## Height and viewport units

| Cause | Fix |
|---|---|
| `h-screen` / `100vh` on mobile hides content under the browser UI | `min-h-dvh` / `h-dvh` (`100dvh`), or `svh` for stable layouts |
| Modal taller than the viewport | `max-h-[90dvh] overflow-y-auto` on the dialog body; sticky footer for actions |
| Fixed height on text containers clips translated/zoomed text | Remove the fixed height, use `min-h-*` |
| Fixed/sticky bottom bar covers content and the last item | Bottom padding equal to the bar height + `pb-[env(safe-area-inset-bottom)]` |
| Sticky header covers anchors and focused elements (WCAG 2.4.11) | `scroll-mt-*` on targets / `scroll-padding-top` on `html` |

## Navigation and headers

- Nav items wrap or overflow at tablet width → collapse to a menu below `lg`, or reduce items; test 768 and 1024 exactly.
- Logo + actions squeeze the search field to nothing → hide secondary actions in an overflow menu on small screens.
- Mobile menu: full-height panel with scroll, focus trap, Esc to close, body scroll lock.

## Sidebars and split layouts

- Sidebar appears at `md` (768) and leaves too little for content → show it from `lg`, or make it collapsible/overlay at tablet.
- Two-column form/detail layouts: stack below `md`; keep labels above inputs on mobile.
- Content `max-w-*` containers with horizontal padding on mobile (`px-4`) so text never touches the edge.

## Dropdowns, popovers, tooltips

- Clipped by an `overflow-hidden` ancestor → render in a portal (library default for Radix/Headless UI), or remove the clipping.
- Off-screen at the right edge on mobile → collision handling (`avoidCollisions`, `collisionPadding`), or `align="end"`.
- Hover-only tooltips/menus (`group-hover:`, `:hover`) unreachable on touch → open on click/focus; essential info not in tooltips.

## Forms on mobile

- Input font size < 16px triggers iOS zoom on focus → `text-base` on inputs at mobile.
- Side-by-side inputs (`grid-cols-2`) too narrow → stack below `sm`.
- Buttons full width on mobile (`w-full sm:w-auto`), primary action reachable without scrolling past a long form (sticky footer if needed).
- Correct `type`/`inputmode` for mobile keyboards.

## Cards, lists, media

- Card grids: `grid-cols-[repeat(auto-fill,minmax(16rem,1fr))]` for fluid columns instead of breakpoint-hopping.
- Card titles: `line-clamp-2` + full text in `title`; metadata rows `flex-wrap`.
- Avatars/thumbnails: fixed square sizes with `shrink-0` so they do not get squashed in flex rows.
- Images: explicit `width`/`height` or `aspect-*` to prevent layout shift; `object-cover` for crops.

## Text expansion (i18n) and long data

- Buttons/tabs/badges with fixed widths → `min-w-*` + padding instead of `w-*`.
- Plan for ~40% text expansion (`.claude/rules/zeross/ui.md`); check the longest locale if available.
- Numbers/currency: right-aligned in tables with `tabular-nums`; large values do not overflow cells.

## Touch and pointer

- Targets ≥ 24×24 px (WCAG 2.5.8), 44×44 recommended for primary mobile actions; spacing between adjacent icon buttons.
- Swipe/drag interactions have a button alternative (WCAG 2.5.7).
- `@media (hover: hover)` for hover styles so touch devices do not get stuck hover states.

## Tablet-specific (768–1024)

- `md:` layouts tuned for 1024 look cramped at exactly 768: check both.
- Landscape phones (~800×375) can fall into `md`: fixed headers + bottom bars leave little room.

## Container queries

If the project uses them (`@container`, Tailwind `@container` / `@sm:`), components should adapt
to their container rather than the viewport; check the component in its narrowest real container
(e.g. inside a sidebar), not only at the page breakpoints.
