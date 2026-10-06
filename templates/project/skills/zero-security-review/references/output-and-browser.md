# Output encoding and browser security: XSS, redirects, CSRF, CORS, framing

Goal: data rendered in a browser stays data; the browser cannot be tricked into acting for the
user on another origin. ASVS V5.3 (output encoding), V13 (API), V14.4–V14.5 (headers), V3.4–V3.5.

## XSS sinks by framework

Frameworks escape text by default. Findings live where code opts out or writes to a raw sink.

| Stack | Raw sinks to trace |
|---|---|
| React / Next | `dangerouslySetInnerHTML`, `ref.current.innerHTML`, `href={userUrl}` / `src` / `action` / `formAction` with `javascript:`, `<iframe srcDoc>`, `<script>` with `JSON.stringify(data)` unescaped |
| Vue / Nuxt | `v-html`, `:href` with user URL, `innerHTML` in directives, render functions with `domProps.innerHTML` |
| Angular | `bypassSecurityTrustHtml/Url/ResourceUrl/Script/Style`, `[innerHTML]` (sanitized, but bypassed by the above) |
| Svelte | `{@html …}` |
| DOM / jQuery | `.innerHTML=`, `.outerHTML=`, `insertAdjacentHTML`, `document.write`, `$(…).html()`, `$(userString)`, `.attr('href', user)`, `location = user`, `eval` |
| EJS / Pug / Handlebars / Nunjucks | `<%- %>`, `!{}` / `!=`, `{{{ }}}` / `SafeString`, `| safe` |
| Jinja2 / Django | `|safe`, `Markup()`, `mark_safe`, `{% autoescape off %}`, `Environment(autoescape=False)`, `format_html` misuse |
| Blade / Twig | `{!! !!}`, `|raw` |
| Thymeleaf / JSP | `th:utext`, `<%= %>` without `fn:escapeXml`, `escapeXml="false"` |
| Go | `text/template` used for HTML, `template.HTML(user)`, `template.JS`, `template.URL` casts |

- [ ] Every raw sink receives either constant/trusted HTML or HTML sanitized with an allowlist sanitizer (DOMPurify, `sanitize-html` with a strict config, bleach/nh3, HTMLPurifier, OWASP Java HTML Sanitizer, bluemonday). Regex stripping is not sanitization.
- [ ] Markdown rendering: HTML disabled (`markdown-it` `html: false`, `react-markdown` without `rehype-raw`) or output sanitized; link `javascript:` blocked.
- [ ] URLs from users in `href`/`src`: scheme allowlist (`http`, `https`, `mailto`), checked on the parsed URL. React warns about `javascript:` but still renders it in many versions.
- [ ] JSON in inline `<script>`: escape `<`, `>`, `&`, U+2028/2029 (`serialize-javascript`, `htmlescape`), or use a `type="application/json"` element + `textContent`.
- [ ] Stored content (names, comments, filenames, uploaded SVG/HTML) rendered elsewhere, including admin panels and emails (stored XSS against admins is High).
- [ ] DOM XSS sources: `location.hash`, `location.search`, `document.referrer`, `postMessage` data, `window.name`, storage.

## postMessage

- [ ] Receivers check `event.origin` against an exact allowlist before using `event.data`. Smells: no check, `indexOf`/`includes`/`endsWith` on origin, regex without anchors.
- [ ] Senders use an explicit `targetOrigin`, never `'*'` when the message carries data.

## Open redirect

Smells: redirect target from input.

```text
res.redirect(req.query.next)   redirect(searchParams.get('callbackUrl'))   router.push(query.returnTo)
return redirect(request.GET['next'])   redirect()->to($request->input('url'))   "redirect:" + url
http.Redirect(w, r, r.URL.Query().Get("to"), …)   window.location = params.get('url')
```

- [ ] Allow only relative paths starting with a single `/`, rejecting `//`, `/\`, `\\`, and control chars; or an exact allowlist of absolute origins. Validate on the parsed URL (`new URL(target, base).origin === base.origin`).
- [ ] Framework helpers: Django `url_has_allowed_host_and_scheme`, Auth.js `redirect` callback restricted to `baseUrl`, Laravel `redirect()->intended()` with stored internal URL.
- [ ] OAuth/SSO `redirect_uri`, logout `post_logout_redirect_uri`, email links: same rule.
- Severity: **Medium** (High when chained with token leakage, e.g. OAuth code or reset token in the redirect).

## CSRF

Relevant when the browser sends credentials automatically: cookie sessions, cookie-stored JWTs,
HTTP basic, client certs. Bearer tokens in `Authorization` set by JS are not CSRF-able.

- [ ] State-changing requests (not GET/HEAD) on cookie auth need one of: synchronizer/double-submit token (csurf successors, `csrf-csrf`, Django/Laravel/Spring built-ins), `SameSite=Strict`/`Lax` plus Origin/Referer verification, or custom-header requirement with a strict CORS policy.
- [ ] `SameSite=Lax` does not cover: GET requests that change state (fix the GET), same-site sibling subdomains, and the 2-minute Lax+POST window some browsers allow for new cookies.
- [ ] Explicit opt-outs are deliberate: Django `@csrf_exempt`, Laravel `VerifyCsrfToken::$except` / `validateCsrfTokens(except:)`, Spring `csrf().disable()` / `csrf { disable() }` with cookie sessions, Rails-like `skip_forgery_protection`.
- [ ] Next.js server actions compare `Origin` with `Host`/`X-Forwarded-Host`; behind proxies `serverActions.allowedOrigins` must not be overly broad. Route handlers (`route.ts`) have **no** built-in CSRF protection.
- [ ] GraphQL over cookies: CSRF prevention on (Apollo `csrfPrevention: true`), no `GET` mutations, reject `text/plain`/form content types.
- [ ] Login CSRF and logout CSRF (Low unless chained).

## CORS

- [ ] `Access-Control-Allow-Credentials: true` only with an exact origin allowlist. Real bugs: reflecting the request `Origin` (`origin: true`, `cors({ origin: (o, cb) => cb(null, true) })`), unanchored regex (`/example\.com/` matches `example.com.evil.io`), `endsWith('example.com')` (matches `evilexample.com`), allowing `null`.
- [ ] `*` without credentials on endpoints returning private data still lets any site read it when auth is not cookie-based (e.g. IP-based or internal-network auth).
- [ ] Starlette/FastAPI `allow_origins=["*"]` + `allow_credentials=True` reflects the origin for cookie requests: treat as reflected-origin.

## Framing, sniffing and other headers

- [ ] Clickjacking on sensitive UIs: `Content-Security-Policy: frame-ancestors 'self'` (or `X-Frame-Options: DENY`).
- [ ] `X-Content-Type-Options: nosniff` on user-content responses; correct `Content-Type` on JSON (`application/json`), never `text/html` for API output.
- [ ] CSP present for apps rendering user content; flag `unsafe-inline` + `unsafe-eval` scripts as weakening (Low/Info unless an XSS exists).
- [ ] `target="_blank"` to untrusted URLs: modern browsers imply `noopener`; Info only.

## Severity guide

Stored XSS reachable by other users: **High** (Critical if it hits admins with account takeover).
Reflected/DOM XSS: **Medium/High** depending on interaction and CSP. CSRF on account settings,
money or role changes: **High**; on minor actions: **Medium/Low**. Credentialed reflected CORS on
private data: **High**.
