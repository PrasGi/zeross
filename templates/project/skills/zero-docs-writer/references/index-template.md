# <Project name> documentation

Module-based docs. Each module doc maps to code through the `sources` globs in its
front matter; `/zero-docs-writer update` keeps the affected docs current and
`/zero-docs-writer audit` lists stale ones.

## Modules

| Module | Apps | Owner | Last updated | Doc |
|---|---|---|---|---|
| <module> | <app, app> | <owner or -> | <YYYY-MM-DD> | [<module>](modules/<module>.md) |

## Conventions

- One file per module in `modules/`; split into `modules/<module>/` above ~400 lines.
- A module marked `(stub)` has only an Overview and a Changelog so far; `/zero-docs-writer create <module>` completes it.
- Document what the code does. Unknowns are marked `> TODO:`.
- Env vars by name only. No secrets.
- English only.
