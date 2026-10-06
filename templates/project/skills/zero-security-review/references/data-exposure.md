# Sensitive data exposure

Goal: responses, logs, errors, caches and client bundles carry only what the recipient is allowed
to see. ASVS V7 (errors, logging), V8 (data protection). OWASP API3 (excessive data exposure).

## Over-fetching in responses

Smells: returning a persistence object directly.

```text
res.json(user)  return user  return await prisma.user.findUnique(...)  res.send(doc)
return Response.json(row)    return $user  /  return User::all()    return ResponseEntity.ok(entity)
json.NewEncoder(w).Encode(dbUser)   serializer with fields='__all__'   .lean() results returned raw
Server Component passing a full DB object to a Client Component prop
```

- [ ] Responses use an explicit output shape: DTO/serializer/resource, `select`/projection, `response_model` (FastAPI), Laravel API Resources or `$hidden`, Jackson `@JsonIgnore`/views, Go response structs or `json:"-"`, DRF explicit `fields`.
- [ ] Fields that must never leave the server: `password`, `passwordHash`, `salt`, `resetToken`, `verificationToken`, `otp`, `otpSecret`/`mfaSecret`, `refreshToken`, `apiKey` (except at creation), `sessionId`, internal flags/notes, other tenants' IDs, raw payment data, KYC documents.
- [ ] Serializer exclusions actually run: Nest `@Exclude()` needs `ClassSerializerInterceptor` and a class instance (plain objects from `.lean()`/raw queries skip it); Mongoose `select: false` is bypassed by explicit `.select('+password')` and by aggregation; `toJSON` transforms skipped by `.lean()`.
- [ ] Lists and search endpoints do not include other users' emails, phones, addresses unless the feature requires it (filter or mask).
- [ ] Next.js: props passed from Server to Client Components are serialized into the HTML/RSC payload; anything passed is public to that user. Same for `getServerSideProps` return values and Nuxt payloads.
- [ ] GraphQL: sensitive fields protected per field; introspection disabled or schema reviewed.

## Errors

- [ ] No stack traces, SQL text, ORM/driver messages, file paths, or internal hostnames in responses. Smells: `res.status(500).json({ error: err.message })`, `err.stack`, `return str(e)`, `c.JSON(500, err.Error())`, Laravel debug mode, Spring `include-message=always`.
- [ ] A central error handler maps errors to safe messages with a correlation ID; details go to logs.
- [ ] Malformed IDs/params produce 400/404, not 500 with a cast error.
- [ ] Authentication and recovery flows return uniform messages (no user enumeration via messages, status codes or timing).

## Logs and telemetry

- [ ] No passwords, tokens, cookies, `Authorization` headers, OTPs, full card numbers, secrets, or whole request bodies of auth/payment endpoints in logs. Smells: `console.log(req.body)`, `logger.info({ req })`, `log.Printf("%+v", req)`, `print(request.data)`, `Log::info($request->all())`.
- [ ] Logger redaction configured where request objects are logged (pino `redact`, winston formats, structlog processors, Logback masking).
- [ ] PII in logs minimized per the project's rule packs (emails/phones masked or hashed).
- [ ] Error trackers (Sentry, etc.) scrub request bodies and headers (`sendDefaultPii: false`, `beforeSend`).
- [ ] Analytics/third-party scripts do not receive PII or tokens in URLs/events.

## Caching

- [ ] Authenticated/personal responses send `Cache-Control: private, no-store` (or are never cached by CDN).
- [ ] Shared caches keyed by user/tenant when content is personal: Next.js `unstable_cache`/`use cache`/`fetch` cache, Redis keys, HTTP caches, memoization at module scope (global variables in serverless/edge persist across requests and users).
- [ ] Next.js: pages reading `cookies()`/`headers()` are dynamic; a personal page statically cached is a cross-user leak (High).

## Data at rest and in transit

- [ ] Highly sensitive fields (national ID, health, bank account, tokens for third-party APIs) encrypted at the application layer or via DB/KMS features, per project policy.
- [ ] Backups/exports/temporary files with PII are access-controlled and expire.
- [ ] Tokens and PII never in URLs (logged by proxies, leaked via `Referer`).

## Exports and files

- [ ] CSV/XLSX export: cells starting with `=`, `+`, `-`, `@`, tab or CR are prefixed with `'` (formula injection when opened in Excel).
- [ ] Exports apply the same authz and tenant filters as the list endpoint.
- [ ] Public object storage URLs are unguessable and short-lived (signed URLs), not sequential.

## Severity guide

Password hashes / tokens / secrets in responses: **High** (Critical when broad). Other users' PII
in responses: **High**. Cross-user cache leak: **High**. Stack traces or SQL in errors: **Medium**.
Secrets/tokens in logs: **Medium** (High if logs are widely accessible). Minor internal fields:
**Low**.
