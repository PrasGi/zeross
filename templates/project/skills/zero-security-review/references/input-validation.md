# Input validation

Goal: every untrusted input is checked against an explicit schema at the boundary, before it
reaches business logic. ASVS V5.1, V12 (files). Validation is not the defense against injection
(parameterization and encoding are), but it shrinks the attack surface and blocks type confusion.

## Untrusted sources

Body, query, path params, headers (incl. `Host`, `X-Forwarded-*`, `Referer`), cookies, uploaded
files and their names, webhook payloads, queue messages, data from third-party APIs, and data
written to the DB by another user (second-order).

## Boundary validation

- [ ] Each changed entry point validates body, query, params and the headers it reads, with the library the project mandates (check `.claude/rules/zeross/*`): zod, class-validator + `ValidationPipe`, joi/celebrate, Fastify JSON schema, pydantic, Django forms/DRF serializers, go-playground/validator, Laravel FormRequest, Bean Validation (`@Valid`).
- [ ] The validated value is the one used. Smell: validating `dto` then using `req.body`; zod `schema.parse(body)` result discarded; Laravel `$request->validate()` then `$request->all()`.
- [ ] Global validation config actually applies (false-positive filter): Nest global pipe in `main.ts`, Fastify route `schema`, Spring `@Valid` present on the parameter (constraints without `@Valid` are ignored), nested objects validated (`@ValidateNested()` + `@Type()`, nested `@Valid`).
- [ ] Unknown fields rejected or stripped (see mass assignment in `authz.md`).

## Per-field rules

- [ ] Type enforced; no implicit coercion surprises. Express `qs` turns `?a[b]=1` into an object and `?id=1&id=2` into an array; a string check must reject both.
- [ ] Strings: max length on every field (incl. search, names, free text); trimmed where relevant; format via allowlist regex anchored `^…$`.
- [ ] Enums: closed set (`status`, `role`, `sort`, `order`, `type`).
- [ ] Numbers: integer vs decimal, min/max, reject `NaN`/`Infinity`/negative where meaningless, money as integer minor units or decimal type (never float).
- [ ] IDs: format checked (UUID, ObjectId via `isValidObjectId`, positive int), so malformed IDs return 400 not 500.
- [ ] Pagination: `limit` capped (e.g. ≤ 100), `page`/`offset` bounded; `sort` field from an allowlist.
- [ ] Dates: parsed strictly, ranges bounded (no 100-year report queries).
- [ ] Email/URL/phone: validated with the library, URLs restricted to `http`/`https` (see SSRF and `javascript:` in `injection.md` / `output-and-browser.md`).
- [ ] Arrays: max items; each item validated.
- [ ] Nested objects: max depth (deeply nested JSON → CPU/stack exhaustion).
- [ ] Unicode: normalize (NFKC) before uniqueness checks on usernames/emails; reject control characters where not expected.

## Request-level limits

- [ ] Body size limit (`express.json({ limit })`, Fastify `bodyLimit`, Nginx/`client_max_body_size`, `http.MaxBytesReader`, Django `DATA_UPLOAD_MAX_MEMORY_SIZE`, Spring `max-request-size`).
- [ ] Trusted proxy configured correctly before using `req.ip` / `X-Forwarded-For` (Express `trust proxy`, Django `SECURE_PROXY_SSL_HEADER`, Laravel `TrustProxies`). Otherwise rate limits and IP allowlists are spoofable.

## File uploads

- [ ] Size limit enforced by the server (multer `limits.fileSize`, Laravel `max:`, etc.).
- [ ] Type allowlist checked by content (magic bytes: `file-type`, `python-magic`, `finfo`), not only extension or client `Content-Type`.
- [ ] Stored outside the webroot / in object storage, with a server-generated name (UUID). Original filename never used as a path; if kept for display, sanitized.
- [ ] Never executed or interpreted: no `.php`/`.jsp`/`.html`/`.svg` served from the same origin with an executable or inline content type. Serve with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`, or from a separate domain.
- [ ] Images re-encoded or stripped of metadata when privacy matters; SVG treated as active content (XSS).
- [ ] Archives: zip-slip (entry paths with `../`), zip bombs (ratio and total size limits).
- [ ] Image/PDF processing libraries (ImageMagick, Ghostscript, LibreOffice, pdf renderers) run with policy limits; treat them as SSRF/RCE surfaces.
- [ ] Presigned upload URLs: constrained key prefix per user, content-length range, content type, short expiry.

## Webhooks and machine inputs

- [ ] Signature verified **before** parsing and acting (see `crypto.md`), then payload schema-validated.
- [ ] Queue/cron consumers validate messages; a poisoned message must not crash-loop or escalate.

## Severity guide

Missing validation alone is usually **Low/Medium**. Raise it only when you can show the impact:
type confusion into a query (NoSQL injection → High/Critical), unbounded size → DoS (Medium),
uploaded HTML/SVG served inline → stored XSS (High), executable upload → RCE (Critical).
