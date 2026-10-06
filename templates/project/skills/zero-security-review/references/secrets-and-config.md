# Secrets and security configuration

Goal: no credential is committed or shipped to the client, and production config fails closed.
ASVS V6.4 (secret management), V14 (configuration).

## Redaction (mandatory)

Never print a secret value, in the report or in tool output you produce. Locate with
file:line only, then view context redacted:

```bash
# 1. Locate: file:line only, no values
grep -rnIE '<PATTERN>' <files> | cut -d: -f1,2
# 2. View a line redacted (keeps the first 4 chars of any long token)
sed -n '<line>p' <file> | sed -E 's/([A-Za-z0-9_\/+=.-]{4})[A-Za-z0-9_\/+=.-]{8,}/\1…[REDACTED]/g'
```

Report form: `AKIA…[REDACTED, 20 chars] at config/aws.ts:12`.

## Secret patterns

The team's canonical baseline is `.claude/rules/zeross/core.md` → "Secrets" (installed in every
project and always loaded): AWS keys, GitHub tokens, OpenAI and Anthropic keys, Stripe keys,
private keys, generic `password|secret|token` assignments, and DB URLs with credentials.

Grep-ready ERE versions of that baseline (macOS/BSD and GNU `grep -E`), plus common extras:

```text
AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}                              # AWS access key id (ASIA = temporary)
aws.{0,20}['"][A-Za-z0-9/+=]{40}['"]                            # AWS secret near "aws"
gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,}          # GitHub tokens (classic + fine-grained)
sk-[A-Za-z0-9]{48}|sk-proj-[A-Za-z0-9_-]{40,}                   # OpenAI (legacy + project keys)
sk-ant-[A-Za-z0-9_-]{90,}                                        # Anthropic
(sk|rk)_(live|test)_[A-Za-z0-9]{10,}|whsec_[A-Za-z0-9]{20,}     # Stripe secret/restricted keys, webhook secrets
-----BEGIN ([A-Z]+ )?PRIVATE KEY-----                            # PEM private keys (RSA, EC, OPENSSH, PGP blocks too)
(password|passwd|pwd|secret|token|api_?key)["']?\s*[:=]\s*["'][^"']{8,}   # generic assignment (case-insensitive: -i)
(postgres(ql)?|mysql|mongodb(\+srv)?|redis|amqps?)://[^:/@\s]+:[^@\s]+@ # connection strings with credentials
xox[abposr]-[A-Za-z0-9-]{10,}                                    # Slack tokens
AIza[0-9A-Za-z_-]{35}                                            # Google API key
npm_[A-Za-z0-9]{36}                                              # npm token
SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}                         # SendGrid
eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,} # JWT (often a long-lived service token)
```

Where to scan:

- [ ] Every file in scope, including tests, fixtures, seeds, notebooks (outputs too), docs, `docker-compose*.yml`, CI files, IaC, `.npmrc`/`.pypirc`/`settings.xml`.
- [ ] Committed env files: `git ls-files | grep -E '(^|/)\.env($|\.)' | grep -vE '\.(example|sample|template)$'`.
- [ ] History on this branch (a removed secret is still leaked): `git log -p "$BASE"..HEAD | grep -cE '<PATTERN>'`. If > 0, report it: the fix is **rotate the secret**, then purge history; deleting the line is not enough.
- [ ] Generic-pattern hits are noisy: ignore obvious placeholders (`changeme` in `.env.example`, `test-password` in unit tests against mocks) but **flag** them when used as a runtime default (below).

## Fallback and default secrets

Critical smell: a real code path that works without the secret configured.

```text
process.env.JWT_SECRET || 'secret'      os.getenv("SECRET_KEY", "dev")      env('APP_KEY', 'base64:…')
viper.GetString("jwt") with SetDefault  @Value("${jwt.secret:changeme}")    const SECRET = "hardcoded"
```

- [ ] Required secrets fail at startup when missing (schema-validated env: `@t3-oss/env`, `envalid`, zod, pydantic `BaseSettings` without defaults).
- [ ] Default admin users/passwords in seeds or migrations that run in production.

## Client-exposed configuration

Anything with these prefixes is inlined into the client bundle and public:
`NEXT_PUBLIC_`, `VITE_`, `REACT_APP_`, `NUXT_PUBLIC_` / `runtimeConfig.public`, `EXPO_PUBLIC_`,
`PUBLIC_` (SvelteKit / Astro), `GATSBY_`, `STORYBOOK_`.

- [ ] No secret behind a public prefix: `NEXT_PUBLIC_*_SECRET`, `*_PRIVATE_KEY`, `*_SERVICE_ROLE*` (Supabase service role = full DB bypass of RLS, Critical), DB URLs, Stripe `sk_`, admin API keys.
- [ ] Server-only modules not importable by client code (`import 'server-only'` in Next.js), server env not read in `'use client'` files, no `process.env` spread into client config (`env: { ...process.env }` in `next.config`).
- [ ] Source maps with embedded secrets or internal URLs published to production (Low/Info unless they contain secrets).
- [ ] Mobile apps: anything in the bundle is public.

## Debug and dev-only features

- [ ] Off in non-local envs, failing closed: Django `DEBUG=True`, Laravel `APP_DEBUG=true` (Ignition), Flask `debug=True` (Werkzeug console = RCE), Express error handler returning `err.stack`, Spring `server.error.include-stacktrace=always`.
- [ ] Exposed tooling: Spring Actuator `management.endpoints.web.exposure.include=*` (`/env`, `/heapdump`), H2 console, Go `net/http/pprof` imported into the public mux, GraphQL introspection/playground, Swagger UI with "try it" on prod, Laravel Telescope/Horizon without gate, Django admin on default path with weak auth.
- [ ] Test-only routes, seed endpoints, "login as" / impersonation endpoints gated to local and to admins.
- [ ] Auth/OTP bypass flags: see `authn.md`.

## Cookies and transport

- [ ] Session/auth cookies: `HttpOnly`, `Secure`, `SameSite`, narrow `Domain`; `__Host-` prefix where possible.
- [ ] HTTPS enforced; HSTS (`max-age` ≥ 1 year) on production responses; no mixed content.
- [ ] TLS verification never disabled (see `crypto.md`).

## Security headers (via helmet, middleware, reverse proxy or `next.config` `headers()`)

| Header | Expectation |
|---|---|
| `Content-Security-Policy` | Present for apps rendering user content; includes `frame-ancestors` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` or stricter |
| `Permissions-Policy` | Disable unused powerful features |
| `X-Powered-By` / `Server` | Removed (Info) |

Headers are often set at the proxy/CDN: check the repo's ingress/nginx/vercel config before flagging.
Missing headers are **Low** unless they enable a concrete attack found elsewhere.

## CORS

See `output-and-browser.md`. Flag `*` origin in production config (team rule), and treat reflected
origins with credentials as High.

## Severity guide

Live production credential committed or in client bundle: **Critical** (rotate first). Test/sandbox
key (`sk_test_`) committed: **Medium**. Fallback secret used when env is missing: **High**
(Critical if production config lacks the variable). Debug console reachable in a deployed env:
**Critical**. Stack traces in responses: **Medium**. Missing headers: **Low**.
