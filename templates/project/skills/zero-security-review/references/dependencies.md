# Dependencies and supply chain

Goal: new or changed dependencies do not bring known vulnerabilities, malicious code, or
unreviewed install-time execution. ASVS V14.2. Scope: only dependencies added or changed in
scope; do not audit the whole tree in `diff` mode.

## 1. What changed

```bash
git diff "$BASE" -- '**/package.json' '**/go.mod' '**/pyproject.toml' '**/requirements*.txt' \
  '**/composer.json' '**/pom.xml' '**/build.gradle*' '**/Gemfile' '**/Cargo.toml'
git diff --stat "$BASE" -- '**/package-lock.json' '**/pnpm-lock.yaml' '**/yarn.lock' '**/bun.lock*' \
  '**/go.sum' '**/poetry.lock' '**/uv.lock' '**/Pipfile.lock' '**/composer.lock' '**/gradle.lockfile'
```

List each added/upgraded/downgraded package with old → new version.

## 2. Scoped audit commands

Run only when a manifest or lockfile changed. Run in the app directory that owns it. These hit the
public advisory APIs; they do not build. If a tool is missing, say so and do not install it
without asking.

| Ecosystem | Command | Notes |
|---|---|---|
| npm | `npm audit --omit=dev --json` | `--audit-level=high` for a quick gate |
| pnpm | `pnpm audit --prod --json` | |
| yarn 1 | `yarn audit --groups dependencies --json` | |
| yarn berry | `yarn npm audit --environment production --recursive --json` | |
| bun | `bun audit` (if the installed Bun supports it) | otherwise use OSV-Scanner |
| Python | `pip-audit -r requirements.txt` or `pip-audit` in the project venv; uv/poetry: export first, e.g. `pip-audit -r <(uv export --format requirements-txt --no-hashes)` | |
| Go | `govulncheck ./...` | Reports only reachable vulns: trust its call-path output |
| PHP | `composer audit --locked --no-dev` | |
| Java/Kotlin | OSV-Scanner on the lockfile, or the project's configured OWASP dependency-check task | Do not trigger a full Gradle/Maven build to run it |
| Any | `osv-scanner scan source -r .` / `osv-scanner --lockfile=<file>` | Good cross-ecosystem fallback |

Report only advisories for packages introduced or changed in scope (or whose resolved version
changed). For each: package@version, advisory ID (GHSA/CVE), severity, fixed version, and whether
the vulnerable code path is reachable (production dep, imported, vulnerable function used).

## 3. Package legitimacy (new packages)

- [ ] Name is not a typosquat of a popular package (`lodahs`, `reqeusts`, `cross-env.js`, swapped scope `@type/` vs `@types/`, `-js`/`.js` suffixes, hyphen vs underscore).
- [ ] Check metadata: `npm view <pkg> time.created maintainers repository dist.tarball scripts`; `pip index versions <pkg>` / PyPI page; `go list -m -versions <mod>`; Packagist page. Red flags: created days ago, single new maintainer, no repository, very low downloads, version jump after a maintainer change.
- [ ] Install-time scripts: `preinstall`/`install`/`postinstall` in a new dep (npm), `setup.py` with network/exec (Python), Composer `scripts`/plugins. pnpm ≥ 10 blocks lifecycle scripts unless listed in `onlyBuiltDependencies`; check additions to that list.
- [ ] Dependency confusion: internal package names (`@company/*` or unscoped internal names) resolve from the private registry (`.npmrc` scope mapping, `--index-url` not `--extra-index-url` for private-only Python packages, Composer `repositories` with `canonical`).
- [ ] Prefer well-known, maintained packages; flag a new dependency that duplicates an existing one in the project (Info).

## 4. Lockfile integrity and drift

- [ ] Manifest changed without the lockfile (CI may resolve different versions): Low, or Medium if CI uses `npm install` instead of `npm ci`.
- [ ] Lockfile changed with no manifest change: inspect why (could be a legitimate `update`, or tampering).
- [ ] `resolved` URLs point to the expected registry (no `http://`, no personal tarball hosts, no git URLs to forks); `integrity` hashes present.
- [ ] `go.sum` entries added for every new module; `GOFLAGS=-mod=mod` / `GONOSUMDB` / `GOPRIVATE` not widened unexpectedly.
- [ ] Python: hashes pinned when the project uses `--require-hashes`; no unpinned `>=` for runtime deps in an app (libraries may use ranges).
- [ ] Version specifiers like `*`, `latest`, `x`, or git branches (`#main`) in production deps.
- [ ] Overrides/resolutions (`overrides`, `resolutions`, `pnpm.overrides`, `replace` in go.mod) do not pin a vulnerable version or redirect to a fork without review.

## 5. Notable known-bad versions to recognize quickly

Not exhaustive; always confirm with the audit tool.

- `log4j-core` < 2.17.1 (Log4Shell family)
- `next` < 15.2.3 / 14.2.25 / 13.5.9 / 12.3.5: middleware bypass via `x-middleware-subrequest` (CVE-2025-29927), relevant when auth relies on `middleware.ts`
- `jsonwebtoken` < 9.0.0 (algorithm/key handling issues)
- `lodash` < 4.17.21 (prototype pollution, command injection in `template`)
- SnakeYAML < 2.0 (unsafe default constructor)
- `xmldom`/`@xmldom/xmldom` old versions, `node-serialize` (any version)

## Severity guide

Known RCE/auth-bypass CVE in a reachable production dependency: **Critical/High** as the advisory
says, adjusted for reachability. Dev-only or unreachable: **Low/Info**. Malicious or typosquatted
package: **Critical**. New install script from an unknown package: **Medium** until reviewed.
Lockfile drift: **Low**.
