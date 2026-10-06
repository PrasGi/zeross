---
name: zero-security-review
description: Expert application-security review (OWASP ASVS L2 bar) of code changes, a module path, or the whole repo. Maps the attack surface, traces source to sink, and checks authN, authZ (IDOR/BOLA/BFLA, tenant isolation, mass assignment), input validation, injection (SQL/NoSQL/command/path/SSRF), XSS/redirect/CSRF, secrets and config, data exposure, business logic and race conditions, crypto, dependencies, CI/infra, and project rules. Reports only verified findings with an exploit scenario and file:line. Use when asked to security-review or audit changes, a branch, a PR, a directory or the repo, or when a zero-* command calls it after touching backend, input-handling or auth code.
argument-hint: "[diff | path <dir> | full] [--fix]"
---

# zero-security-review

You are a senior application security engineer reviewing to an **OWASP ASVS Level 2** bar.
Your job is to find real, exploitable weaknesses in this code and prove each one. Fewer proven
findings beat a long list of maybes. Every reported finding must survive the Phase 3 gate.

## 1. Arguments and modes

**Scope** (first positional argument):

| Scope | What is reviewed |
|---|---|
| `diff` (default) | Files changed vs the base branch (committed + staged + unstaged + untracked), plus one hop of call graph each way |
| `path <dir>` | Every source file under `<dir>`, plus the middleware/guards/config that apply to it |
| `full` | The whole repo. Only when the user explicitly typed `full`. Never infer it |

**Run mode** (decided by the caller, never guessed):

| Mode | When | Behavior |
|---|---|---|
| `report-only` | Invoked directly by the user without `--fix` | Report, then ask (`AskUserQuestion`) which findings to fix |
| `fix-blockers` | A zero-* command calls this skill and says so, or the user passed `--fix` | Fix Critical and High findings that are inside the task scope; report Medium/Low/Info; ask before any fix outside the task scope |

A calling command passes: the mode, the scope, and the task's file list. Treat that file list as
the fix boundary.

## 2. Load context (before reading code)

**Skip any file already in context** (a calling command usually has the config, rules and
knowledge loaded). Otherwise read:

1. `.claude/zeross/config.json`: `project.apps[]` (`path`, `kind`, `stack`, `dev.url`), `git.baseBranch`, `db.type`, `db.devHosts`.
2. Rule packs: auto-loaded by Claude Code from `.claude/rules/zeross/` (path-scoped packs load when you touch matching files). Read explicitly only a pack that is not yet in context but applies to the scope (e.g. a `be-*.md` pack for a backend file you have not opened yet), plus `custom.md`. Note any security-relevant mandate (validation library, layering, logging, error shape). These feed category 12.
3. `.claude/zeross/knowledge/README.md`, then the relevant topics, especially `auth-login.md` (login methods, local-only bypasses, test roles). Never print secrets; keychain refs are fine.
4. `~/.claude/zeross/profile.json`: `capacity.understanding` (max parallel read-only subagents), `executor`.
5. Resolve the file set:

```bash
BASE=$(git merge-base HEAD "origin/<baseBranch>" 2>/dev/null || git merge-base HEAD "<baseBranch>")
git diff --name-only --diff-filter=ACMRT "$BASE"     # committed + staged + unstaged vs base
git ls-files --others --exclude-standard             # new untracked files
git diff --stat "$BASE"                              # size, to decide on fan-out (§6)
```

Drop generated, vendored and binary files (`dist/`, `build/`, `vendor/`, `node_modules/`, `*.min.js`, snapshots). Keep lockfiles, manifests, Dockerfiles, CI and IaC: they are in scope.

6. **Analyze the stacks touched yourself.** `project.apps[].stack` is only a hint (free-form, written at install).
   Decide from the code: the owning app's manifests (`package.json`, `go.mod`, `pyproject.toml`/`requirements*.txt`,
   `composer.json`, `pom.xml`/`build.gradle*`), framework entry files and the imports in the changed files.
   Name the stacks you concluded in the report header, then load the matching references.

### Reference loading

Load **only** what the stacks and the changed code need. Read each with `${CLAUDE_SKILL_DIR}/references/<file>`.

| Reference | Load when |
|---|---|
| `secrets-and-config.md` | Always (cheap, high value) |
| `authz.md` | Any entry point, query or service method changed (nearly always) |
| `input-validation.md` | Any entry point, DTO, schema or upload handler changed |
| `authn.md` | Login, session, token, password, OTP/MFA, OAuth, auth middleware or user model touched |
| `injection.md` | Queries, shell, filesystem paths, templates, regex, outbound URLs, deserialization, `eval` |
| `output-and-browser.md` | HTML/templates/FE rendering of data, redirects, cookie-auth state changes, `postMessage`, CORS |
| `data-exposure.md` | Responses, serializers, errors, logging or caching changed |
| `business-logic.md` | Money, credits, quotas, inventory, counters, coupons, state transitions, multi-step flows, OTP/reset |
| `crypto.md` | Tokens, randomness, hashing, signatures, webhooks, encryption, TLS options |
| `dependencies.md` | A manifest or lockfile changed |
| `infra-and-ci.md` | Dockerfile, compose, k8s, Terraform, `.github/workflows/*` changed |
| `stack-node.md` | Node app: Express, Fastify, Nest, Next.js, tRPC, GraphQL |
| `stack-go.md` | `go.mod` app |
| `stack-python.md` | FastAPI, Django/DRF, Flask |
| `stack-php-laravel.md` | `composer.json` / Laravel |
| `stack-java-spring.md` | Spring (Java or Kotlin) |
| `db-mongo.md` | `db.type` is `mongodb`, or Mongoose / Mongo driver code in scope |
| `db-sql.md` | `db.type` is `postgres`/`mysql`, or SQL / SQL ORM code in scope |

## 3. Phase 1: attack-surface map

Build this map before judging anything. Keep it in your working notes; summarize it in the report.

1. **Entry points touched**: HTTP routes, controllers, GraphQL resolvers, Next.js route handlers and server actions, RPC/tRPC procedures, webhooks, queue/cron consumers, CLI commands, WebSocket handlers. Record method, path, file:line.
2. **Global protection layer**: read it once, up front. App bootstrap (`main.ts`, `app.ts`, `server.go`, `settings.py`, `bootstrap/app.php`, `Kernel.php`, `SecurityFilterChain`), global middleware, guards, pipes, interceptors, validation config, error handlers, CORS, helmet/headers, rate limiters, Next.js `middleware.ts` matcher. Note which entry points each one covers and which are excluded (public decorators, matcher exclusions, `withoutMiddleware`, `permitAll`).
3. **Trust boundaries**: where data crosses from untrusted to trusted (client → server, webhook → handler, tenant A → shared store, user file → disk, server → third party).
4. **Data stores and outbound calls**: DB collections/tables touched, caches, object storage, queues, HTTP clients, email/SMS, shell, filesystem.
5. **Source → sink trace** for every changed entry point: follow each untrusted input (body, query, params, headers, cookies, files, webhook payload, queue message, DB value written by another user) through the one-hop call graph to every sink (query, command, path, template, redirect, response, log, outbound URL, privileged state change). Note each check (authn, authz, validation, encoding) found on the way, with file:line.

One-hop call graph: for each changed function, read its callers (grep the symbol) and its callees defined in the repo (service, repository, DTO/schema, helper). In `path`/`full` mode trace every entry point under the scope.

## 4. Phase 2: checklist

### Deterministic scanners (when installed)

Before the manual walk, run the scanners that are **already installed** (`command -v gitleaks`,
`command -v semgrep`). Never install them, never send code to a remote service, and never let a
missing scanner block the review.

- **gitleaks** (secrets), redacted output only, report into the gitignored local dir:
  ```bash
  mkdir -p .claude/zeross/local/scan
  gitleaks git --redact --no-banner --log-opts="$BASE..HEAD" \
    --report-format json --report-path .claude/zeross/local/scan/gitleaks-git.json
  n=0; for f in <each changed or untracked file>; do n=$((n+1))
    gitleaks dir --redact --no-banner "$f" \
      --report-format json --report-path ".claude/zeross/local/scan/gitleaks-dir-$n.json"
  done
  ```
  `gitleaks dir` takes one path, so run it once per file (or once per changed directory),
  each with its own report file; a single fixed `--report-path` would be overwritten.
  Older gitleaks versions use `gitleaks detect` (`--no-git` for files). If a flag is rejected, check
  `gitleaks --help` and adapt; keep `--redact`.
- **semgrep** (SAST) on the scope files only, metrics off:
  ```bash
  semgrep scan --metrics=off --json --quiet \
    --config <.semgrep.yml or .semgrep/ if the repo has one, else p/default> <scope files> \
    > .claude/zeross/local/scan/semgrep.json
  ```
  Registry packs such as `p/default` download rules only; no code leaves the machine. If the rule
  download fails offline, note it and continue.

Treat every scanner hit as a **candidate**: it goes through the same map and the Phase 3 gate as
anything you find by hand. Drop false positives with a one-line reason; never forward raw scanner
output. Record in the report header which scanners ran, were skipped (not installed), or failed.

### Manual walk

Walk all 12 categories against the map. The reference table in §2 says which file holds the
patterns, greps and safe forms for each.

1. **AuthN**: JWT verification, sessions, password hashing, OTP/MFA bypass flags, token storage, logout, reset. → `authn.md`
2. **AuthZ**: IDOR/BOLA, BFLA, tenant isolation, mass assignment. → `authz.md`
3. **Input validation**: boundary schemas, limits, unknown fields, uploads. → `input-validation.md`
4. **Injection**: SQL/NoSQL, command, path, SSTI, ReDoS, prototype pollution, deserialization, XXE, SSRF. → `injection.md`, `db-*.md`
5. **Output and browser**: XSS sinks, `postMessage`, open redirects, CSRF, CORS. → `output-and-browser.md`
6. **Secrets and config**: hard-coded or fallback secrets, client-exposed env, debug flags, cookies, headers. → `secrets-and-config.md`
7. **Data exposure**: over-fetching, PII in logs, leaky errors, cross-user caching. → `data-exposure.md`
8. **Business logic**: races, double spend, tampering, state-machine bypass, replay, rate limits. → `business-logic.md`
9. **Crypto**: custom crypto, CSPRNG, timing-safe compares, webhook HMAC, TLS verification. → `crypto.md`
10. **Dependencies**: new or changed deps only; scoped audit, typosquatting, install scripts, lockfile drift. → `dependencies.md`
11. **Infra in the diff**: containers, IAM, K8s secrets, public resources, GitHub Actions. → `infra-and-ci.md`
12. **Project rules compliance**: the packs in `.claude/rules/zeross/` and `custom.md`. Violations with security impact at their real severity; pure convention violations as Low/Info.

## 5. Phase 3: verification gate (mandatory)

A candidate becomes a finding only if all of these hold:

- **Exploit scenario**: concrete `input → path → impact`. Name the attacker (anonymous, any logged-in user, tenant member, admin), the exact request or payload, the code path with file:line hops, and what they gain.
- **Location**: the file:line where the fix belongs (the sink or the missing check).
- **False-positive filter**: before reporting "missing auth/validation/escaping", confirm no global middleware, guard, pipe, interceptor, ORM hook, DB constraint, framework default or upstream caller already handles it. Cite where you looked.
- **Reachability**: the code is reachable from an entry point in production config (not test-only, not behind a disabled flag), or note the condition.
- **Confidence** and **severity** assigned with the rubrics below.

**Confidence**: **High**: traced end to end with no mitigation, or proven dynamically. **Medium**: path traced, but a control outside the repo (gateway, WAF, infra) could mitigate; say which. **Low**: pattern match only. Low-confidence items never go in the findings table; list at most 5 under "Leads".

**Severity rubric**:

| Severity | Meaning (examples) |
|---|---|
| Critical | Unauthenticated or any-user path to RCE, auth bypass, SQL/NoSQL injection on a reachable endpoint, cross-tenant data at scale, live production secret committed, money/credit minting |
| High | Authenticated user reads/changes other users' data (IDOR/BOLA), privilege escalation (BFLA, mass-assigned `role`), stored XSS, SSRF to internal network or metadata, unsigned webhooks accepted, OTP brute-forceable, bypass flag reachable outside local |
| Medium | Needs user interaction or unusual conditions: reflected XSS, CSRF on a meaningful action, open redirect, user enumeration, missing login rate limit, stack traces/internal details leaked |
| Low | Defense-in-depth gaps with no direct exploit: missing headers, weak-but-unexploitable config, verbose non-sensitive errors |
| Info | Hardening advice, convention-only rule deviations |

**Dynamic proof** (optional, raises confidence to High):

- Only against **local** targets: `localhost`, `127.0.0.1`, `::1`, `*.localhost`, `*.local`, the hosts in `project.apps[].dev.url`, and `db.devHosts`. **Never** send a request to any other host, even if the user's env points there.
- Only if the dev server is already running; never start a build. If down, skip proof or ask the user to start it.
- Use `curl` or the Playwright MCP (resolve the server via `profile.json → mcpRoles.playwright`). Log in per `.claude/zeross/workflow/browser.md` and `knowledge/auth-login.md`.
- Benign payloads only: read another test user's record, not delete it. No destructive SQL, no mass updates, no time-based payloads longer than 2 s.
- Any DB write follows `.claude/zeross/workflow/data-safety.md` (write log, cleanup).

**Secrets**: always redact. Show at most the first 4 characters plus `…[REDACTED, <n> chars]`. Redact in commands you run too (pipe grep output through the redaction `sed` in `secrets-and-config.md`). Never copy a secret into a fix, a test or the report.

## 6. Large scopes: parallel read-only subagents

Fan out when the scope exceeds ~25 source files or ~1,500 changed lines, or for `path`/`full` on a large module.

1. Build the Phase 1 map yourself first. Subagents get it; they do not rebuild it.
2. Split into checklist groups. Run at most `capacity.understanding` at once (serial if `executor` is `serial`):
   - G1: AuthN, AuthZ, Business logic
   - G2: Input validation, Injection, Output and browser
   - G3: Secrets and config, Data exposure, Crypto
   - G4: Dependencies, Infra and CI, Project rules
3. Use native subagents (the Agent tool), read-only: tell each it must not edit files, run builds, run tests or send network requests. Give each: the map, its file list, the absolute reference paths to load, and this output schema per candidate: `category, file:line, title, scenario, evidence (≤10 lines), mitigations checked, confidence`.
4. **You verify every candidate** by re-reading the cited code and re-running the Phase 3 gate. Drop or downgrade anything you cannot confirm. Never forward a subagent result unverified.

## 7. Fixing

- `fix-blockers`: fix Critical and High findings whose fix is inside the task's files. Fix at the root (scoped query, DTO allowlist, parameterized query, guard), matching the project's existing patterns and rule packs. Add or update a regression test per `.claude/zeross/workflow/testing.md` (related test files only; prove it fails before the fix). If a fix needs files outside the scope, a schema change, or a behavior decision, stop and ask.
- `report-only`: after the report, ask with `AskUserQuestion` (≤4 questions, recommended option first): fix all Critical/High (Recommended), choose findings, or report only.
- After fixing, re-run the gate on each fixed finding and set its status: `fixed`, `open`, `needs decision`.
- Never commit, push, build, run the whole test suite, or install tools without the user's request.

## 8. Output format

```markdown
## Security review: <scope> (<base>..HEAD, <n> files)
**Verdict: <CHANGES REQUIRED | PASS WITH NOTES | PASS>** (<c> Critical, <h> High, <m> Medium, <l> Low, <i> Info). Mode: <report-only | fix-blockers>
Stacks: <...>. References loaded: <...>. Subagents: <n or none>.
Scanners: gitleaks <ran: n hits, m confirmed | not installed | failed: reason>; semgrep <same>.

### Attack surface
<3–8 lines: entry points touched, global protections found, trust boundaries>

### Findings
| ID | Severity | Category | Location | Title | Confidence | Status |
|---|---|---|---|---|---|---|
| S1 | High | AuthZ (BOLA) | src/orders/orders.controller.ts:42 | Any user can read any order by ID | High | open |

### S1: Any user can read any order by ID
- **Scenario**: logged-in user B sends `GET /orders/<A's id>` → `OrdersController.get` (orders.controller.ts:42) → `OrdersService.findById` (orders.service.ts:18) queries by `_id` only → B receives A's order, address and phone.
- **Evidence**: <short code excerpt>; global `JwtAuthGuard` authenticates but no ownership check exists (checked `app.module.ts:30`, `orders.service.ts`).
- **Fix**: scope the query by owner: `findOne({ _id: id, userId: user.id })`; return 404 on miss. <diff if fixed>

### Checked: no issues
- AuthN: <what was checked, one line>
- ... one line per category with no findings

### Not applicable
- Dependencies: no manifest or lockfile change.

### Leads (low confidence, not counted)
- <file:line: what to check and why it could not be confirmed>
```

Verdict: **CHANGES REQUIRED** if any Critical/High is open; **PASS WITH NOTES** if only Medium or lower remain open; **PASS** if nothing remains open.
Every one of the 12 categories appears exactly once across Findings, "Checked: no issues" and "Not applicable", so coverage is visible.

## 9. Never

- Report a finding without a scenario and file:line, or that you have not verified yourself.
- Send any request to a non-local host, or run destructive payloads anywhere.
- Print an unredacted secret or password.
- Widen `diff` scope to `full` on your own.
- Edit files in `report-only` mode before the user chooses.
- Hard-code MCP server names; resolve roles via `profile.json → mcpRoles`.
