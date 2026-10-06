# Stack: Node.js (Express, Fastify, NestJS, Next.js, tRPC, GraphQL)

Read the global protection layer first; most false positives in Node apps come from missing it.

## Locate the protection layer

```bash
grep -rnE "app\.use\(|useGlobal(Pipes|Guards|Interceptors|Filters)|APP_(GUARD|PIPE|INTERCEPTOR)|ValidationPipe|helmet\(|cors\(|rateLimit|ThrottlerGuard|trust proxy" --include=*.{ts,js,mjs,cjs} .
ls middleware.{ts,js} src/middleware.{ts,js} 2>/dev/null     # Next.js middleware + its `config.matcher`
grep -rnE "^['\"]use server['\"]" --include=*.{ts,tsx,js,jsx} .   # server action files
find . -path ./node_modules -prune -o -name 'route.[tj]s' -print   # Next.js route handlers
```

## Express

- [ ] Routes in scope are mounted behind the auth middleware (check router mounting order: `app.use('/api', auth, router)` vs routes registered before `auth`).
- [ ] Express 4: async handlers without a wrapper/`express-async-errors` leave unhandled rejections (crash or hung request); Express 5 handles them.
- [ ] `express.json({ limit })` / `urlencoded({ limit, extended })` set; `extended: true` (qs) produces nested objects and arrays from query/form: string checks must reject them (NoSQL injection, type confusion).
- [ ] `app.set('trust proxy', …)` matches the deployment (exact hop count or proxy IPs, not `true` when directly exposed).
- [ ] `res.sendFile`/`res.download` with user input use `{ root }` and `dotfiles: 'deny'`; `express.static` does not serve the project root.
- [ ] Error handler does not return `err.stack`/`err.message` in production; `x-powered-by` disabled (Info).
- [ ] Sessions: `express-session` with a strong `secret` from env, `cookie: { httpOnly, secure, sameSite }`, a persistent store (MemoryStore leaks and is per-process), `regenerate()` on login.

## Fastify

- [ ] Route `schema` declared for `body`, `querystring`, `params`, `headers`; unknown properties need `additionalProperties: false` (Fastify's Ajv `removeAdditional` only strips when that is set). Ajv default `coerceTypes` can turn `"1"` into `1`; ensure expectations hold.
- [ ] `response` schema doubles as an output allowlist (fast-json-stringify drops unlisted fields): its absence on user objects is a data-exposure smell.
- [ ] Hooks (`onRequest`/`preHandler`) for auth are registered in the right encapsulation context (plugins without `fastify-plugin` do not leak hooks to siblings, so routes in another plugin are unprotected).
- [ ] `bodyLimit`, `@fastify/helmet`, `@fastify/rate-limit`, `@fastify/cors` config reviewed.

## NestJS

- [ ] Global `ValidationPipe` in `main.ts` with `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`. Without `whitelist`, extra fields pass through to `Object.assign`/ORM saves (mass assignment).
- [ ] DTOs: every property has a decorator (undecorated properties are stripped under `whitelist`, or pass unchecked without it); nested objects use `@ValidateNested()` **and** `@Type(() => Child)`; arrays `{ each: true }`; `@IsOptional()` only where truly optional; IDs via `ParseUUIDPipe`/`ParseIntPipe`/an ObjectId pipe.
- [ ] Guards: global `APP_GUARD` (JWT/session) + a `@Public()` decorator via `Reflector` is the common pattern; check every new `@Public()` is intended and the metadata key matches the guard. Controller vs handler `@UseGuards` order; `RolesGuard` must run after the auth guard.
- [ ] `@Roles()` present on privileged handlers; ownership checks in the service (guards rarely check objects).
- [ ] Output: entities with `@Exclude()` need `ClassSerializerInterceptor` (global or controller) and class instances; returning `.lean()`/raw objects bypasses it.
- [ ] TypeORM: `query()`, `` createQueryBuilder().where(`… ${x}`) ``, `.orderBy(userInput)`; Mongoose: filters built from `@Body()` objects. See `db-*.md`.
- [ ] Microservice/event handlers (`@MessagePattern`, `@EventPattern`) validate payloads too (global pipes may not apply to hybrid apps unless configured).
- [ ] `@nestjs/throttler` on auth/OTP routes; GraphQL `@nestjs/graphql` resolvers guarded per resolver/field.

## Next.js (App Router and Pages Router)

- [ ] **Every route handler** (`app/**/route.ts`) and **every API route** (`pages/api/**`) is a public HTTP endpoint: it must authenticate, authorize and validate inside the handler (or in a shared wrapper it calls).
- [ ] **Every exported function in a `'use server'` file** (and inline server actions) is a public POST endpoint callable with arbitrary arguments, even if no UI calls it. Inside each: `auth()`/session check, authorization on the object, schema validation (zod) of arguments. Closure-captured values are encrypted, but arguments are attacker-controlled.
- [ ] `middleware.ts` is not the only auth layer: matcher gaps (`/api`, `/_next/data`, trailing slashes, locales), Edge runtime differences, and CVE-2025-29927 (`x-middleware-subrequest` bypass in `next` < 15.2.3 / 14.2.25 / 13.5.9 / 12.3.5). Check the `next` version when auth relies on middleware.
- [ ] Server → Client Component props are serialized to the browser: pass DTOs, not DB rows/users with hashes. Same for `getServerSideProps`/`getStaticProps` return values.
- [ ] `import 'server-only'` in modules holding secrets/DB access; no server env in `'use client'` files; `NEXT_PUBLIC_*` holds only public values.
- [ ] Caching: personal data not in `fetch` cache / `unstable_cache` / `'use cache'` without user-scoped keys; routes reading cookies are dynamic.
- [ ] `redirect()`/`NextResponse.redirect()` targets from `searchParams` (`callbackUrl`, `next`, `returnTo`) validated (open redirect).
- [ ] `next.config`: `images.remotePatterns` not `**` wildcard hostnames (open image proxy / SSRF-ish abuse), `dangerouslyAllowSVG` with CSP, `rewrites` to internal services not exposing admin paths, `headers()` for security headers, `serverActions.allowedOrigins` narrow.
- [ ] `revalidatePath`/`revalidateTag` endpoints protected (cache-busting DoS).
- [ ] Auth.js/NextAuth: `AUTH_SECRET` set, `jwt`/`session` callbacks do not copy client-controlled data into the token, `signIn` callback enforces allowed domains if intended, `redirect` callback restricts to `baseUrl`, `allowDangerousEmailAccountLinking` off.

## tRPC

- [ ] New procedures use `protectedProcedure` (or a role-specific one), not `publicProcedure`, unless public by design.
- [ ] `.input(zodSchema)` on every procedure; ownership checks inside; output shapes explicit.

## GraphQL (Apollo, Yoga, Mercurius, Nest GraphQL)

- [ ] Auth on each resolver and sensitive field; dataloaders keep per-user context.
- [ ] Depth/complexity/alias limits, batch limits; introspection and playground off in production.
- [ ] CSRF prevention (Apollo `csrfPrevention: true`) with cookie auth; no mutations over GET.

## Generic Node sinks

```bash
grep -rnE "child_process|exec\(|execSync|spawn\(.*shell|eval\(|new Function\(|vm\.run|\.innerHTML|dangerouslySetInnerHTML|res\.redirect\(|sendFile\(|fs\.(readFile|createReadStream|writeFile)|path\.join\(.*req\.|lodash\.merge|_\.merge|_\.set\(|Math\.random|rejectUnauthorized|jwt\.decode|\$queryRawUnsafe|\$executeRawUnsafe|\.query\(\`" --include=*.{ts,tsx,js,jsx,mjs,cjs} <scope>
```

- [ ] `JSON.parse` on large untrusted input without size limits; `Buffer.allocUnsafe` content leaked.
- [ ] WebSocket (`ws`, Socket.IO): auth at connection (not just on the page), origin check, per-message authz on room/IDs, message size limits.
- [ ] Workers/queues (BullMQ etc.): job data validated; jobs run with the right tenant context.
