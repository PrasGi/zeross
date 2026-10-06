# Express and Fastify rules

Applies to: Node.js backends on Express, Fastify, Koa or Hono (TypeScript or JavaScript).

> Strictness follows `rules.strictness`; comments follow `rules.commentPolicy` (JSDoc/TSDoc); tests follow `rules.testPolicy`. Read with `be-core.md`.

## Structure

- Use routers or plugins per domain (`routes/users.ts` → `services/users.ts` → `repositories/users.ts`), following the app's layout.
- Handlers are thin: validate, authorize, call a service, map the response.
- Build the app in a factory (`buildApp()` / `createServer()`) separate from `listen()`, so tests can inject requests without a real port.
- Validate config at startup (zod, envalid or `@fastify/env`). Fail fast on missing env vars, and never read `process.env` deep in services.

## Validation

- **Fastify:** every route declares a JSON `schema` for `body`, `querystring`, `params` and `response` (or uses a TypeBox/zod type provider). Response schemas also strip internal fields.
- **Express/Koa/Hono:** use the project's validation middleware (zod, joi, celebrate, express-validator, `@hono/zod-validator`) on every route. Parse it into a typed object, and never use `req.body` directly after validation.
- Reject unknown fields and cap `limit`. Configure body size limits (`express.json({ limit })`, Fastify `bodyLimit`).

## Middleware and plugin order

- Order matters: security headers (helmet) → CORS (explicit allowlist, never `*` with credentials) → body parsing → rate limiting → auth → routes → 404 → error handler.
- **Fastify:** respect encapsulation. Use `fastify-plugin` only for decorators that must be shared. Register auth as an `onRequest`/`preHandler` hook on the scoped plugin.
- Rate-limit auth, OTP, password reset and other abuse-prone routes.

## Async and errors

- **Express 4:** wrap async handlers (the project's `asyncHandler`, or `express-async-errors`) so rejections reach the error middleware. Express 5 and Fastify handle async natively.
- Use one central error handler that maps typed domain errors to status codes and the project's error shape. Never send `err.message` from libraries or stack traces to clients.
- No floating promises. Always `await` or `return`. Handle `unhandledRejection` and `uncaughtException` at the process level by logging and exiting, per the project's convention.
- Never block the event loop: no sync `fs`, `crypto.*Sync` or big JSON loops in request paths. Stream large payloads.

## Auth and security

- Get the current user from verified auth middleware (`req.user`, `request.user`), never from the body or query.
- JWT: pin the algorithm, and verify `exp`, `aud` and `iss`. Prefer httpOnly, `Secure`, `SameSite` cookies when the app uses cookies, plus CSRF protection for cookie auth.
- Prevent prototype pollution: never deep-merge untrusted objects into config or models, and reject `__proto__`/`constructor` keys.
- Path traversal: resolve user-supplied paths against a base directory and verify the prefix.

## Data access

- Use the project's ORM or query builder (Prisma, Drizzle, Knex, TypeORM, Mongoose, Kysely), with parameterized queries only.
- Transactions for atomic multi-step writes (`prisma.$transaction`, `db.transaction`, Mongo sessions).
- Close pools and clients on shutdown (`SIGTERM` handler, Fastify `onClose`).

## Logging

- Use the project's logger (pino or winston) with a request ID (`req.id` / `genReqId`). Never `console.log` in committed code.
- Redact `authorization`, `cookie`, `password` and token fields in logger config.

## Testing

- **Fastify:** `app.inject()`. **Express/Koa/Hono:** `supertest(app)` or `app.request()`.
- Per route, cover: valid, invalid schema (400/422), unauthenticated, forbidden or another tenant's resource, not found, error-handler mapping.
- Mock outbound HTTP with `nock` or MSW. Use a test DB or container for repositories.
