# AuthZ: IDOR/BOLA, BFLA, tenant isolation, mass assignment

Goal: an authenticated user can act only on their own objects, with only the functions their role
allows, inside their own tenant, and cannot set fields they do not own. ASVS V4. OWASP API Top 10
API1 (BOLA), API3 (BOPLA), API5 (BFLA).

Authorization must be enforced server-side, per request, on the object. A hidden button, a
disabled route in the SPA, or a check in Next.js `middleware.ts` alone is not authorization.

## Method

For each changed entry point, fill this row in your notes:

| Entry point | Who may call (role) | Object IDs from client | Ownership/tenant check (file:line) | Fields writable from client |
|---|---|---|---|---|

Any empty "check" cell on a row with client-supplied IDs is a candidate. Then apply the
false-positive filter: look for policies, guards, scoped repositories, ORM global scopes,
Postgres RLS, Prisma extensions, Mongoose plugins that inject the filter.

## IDOR / BOLA (object level)

Smells: lookup by an ID from `params`/`query`/`body` with no owner or tenant in the filter.

```text
findById(req.params.id)          findOne({ _id: id })           Model::find($id)
repo.findOne({ where: { id } })   prisma.x.findUnique({ where: { id } })
Order.objects.get(pk=pk)          db.First(&o, id)              repository.findById(id)
```

Safe forms: scope the query, do not fetch-then-compare unless the compare is guaranteed.

```ts
prisma.order.findFirst({ where: { id, userId: session.user.id } })      // 404 when null
Order.findOne({ _id: id, tenantId: ctx.tenantId, ownerId: ctx.userId })
```

- [ ] Every read, update, delete, export, download, share and "send" by ID checks ownership or permission. Updates and deletes: put the owner in the `WHERE`, not just the read before it.
- [ ] Bulk endpoints check **every** ID in the array, not the first.
- [ ] Nested resources check the parent chain: `/projects/:pid/tasks/:tid` must verify the task belongs to the project **and** the user may access the project.
- [ ] Indirect references: file keys, S3 object keys, signed-URL generators, attachment IDs, invoice numbers, email/username lookups, GraphQL node IDs, WebSocket room joins, queue jobs that act on IDs from a message.
- [ ] Non-guessable IDs (UUIDs) are not authorization; report the missing check anyway (lower severity only if IDs are never exposed to other users).
- [ ] Existence oracles: 403 vs 404 differences on other users' objects (Low).
- [ ] GraphQL: field resolvers and relations (`user { orders { ... } }`) apply the same checks; batch/alias queries do not bypass per-object checks.

## BFLA (function level)

- [ ] Admin/staff/internal functions have an explicit role/permission check at the handler or route group: Nest `@Roles()` + `RolesGuard`, Laravel `can:` / Policy / Gate, Django/DRF `permission_classes`, Spring `@PreAuthorize` (with method security enabled), Express/Fastify route-group middleware, Next.js server action body.
- [ ] New routes landed inside the protected group. Go routers and Express: routes registered on the base router instead of the `admin` group silently skip the middleware.
- [ ] Public markers are deliberate: `@Public()`, `@AllowAnonymous`, `permitAll()`, `AllowAny`, `withoutMiddleware`, `middleware.ts` matcher exclusions.
- [ ] Role from the server's session or verified token, never from body/query/header (`X-User-Role`, `isAdmin: true`).
- [ ] Role hierarchy correct: "manager" endpoints reject "member"; a user cannot grant a role higher than their own; a tenant admin is not a platform admin.
- [ ] HTTP method gaps: the guard covers `PUT`/`PATCH`/`DELETE`, not just `POST`; `HEAD`/`OPTIONS` do not execute handlers.

## Multi-tenant isolation

- [ ] The tenant ID comes from the authenticated context (session, token claim, subdomain resolved server-side), never from the request body/query.
- [ ] Every query on tenant-scoped data includes the tenant filter: finds, counts, aggregates (`$match` first stage), `$lookup` sub-pipelines, joins, raw SQL, search indexes, cache keys, file storage prefixes, background jobs and exports.
- [ ] Central enforcement preferred: repository base class, Prisma client extension, Mongoose plugin, Laravel global scope, Hibernate filter, Postgres RLS with `SET LOCAL app.tenant_id` inside the transaction (pooled connections leak plain `SET`).
- [ ] Unique constraints include the tenant (`UNIQUE (tenant_id, email)`), or one tenant can block or probe another.
- [ ] Cross-tenant admin features are BFLA-protected and audited.

Grep for queries missing a tenant field when the project uses one:

```bash
grep -rnE "\.(find|findOne|findMany|findFirst|count|aggregate|update\w*|delete\w*)\(" <changed files> | grep -v tenant
```

## Mass assignment (object property level)

Smells: client object spread or bound into a model or update.

```text
Model.create(req.body)        new User(req.body)          Object.assign(entity, dto)
{ ...req.body }               findByIdAndUpdate(id, req.body)   updateOne(f, { $set: req.body })
prisma.user.update({ data: body })   $request->all()  /  $guarded = []   fill($request->all())
ModelSerializer fields='__all__'      @RequestBody User user (JPA entity)  json.Decode(&dbModel)
c.Bind(&model) (gin/echo)             Model(**payload) / obj.__dict__.update(...)
```

- [ ] Writes go through an allowlist DTO/schema that excludes `role`, `isAdmin`, `permissions`, `ownerId`, `userId`, `tenantId`, `orgId`, `status`/`state`, `balance`, `credits`, `price`, `verified`/`emailVerified`, `createdAt`, `id`/`_id`, `password`/`passwordHash`.
- [ ] Unknown fields rejected or stripped: Nest `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`, zod `.strict()` (default `z.object` strips, which is acceptable), pydantic `extra='forbid'`, Fastify `additionalProperties: false`, Laravel `$request->validated()` + `$fillable`, DRF explicit `fields` + `read_only_fields`, Spring DTO records, Go request structs separate from DB models.
- [ ] Nested writes: Prisma `connect`/`create` in nested relations, Mongoose dotted keys (`"profile.role"`), JSON-merge-patch on whole documents.
- [ ] Update operators cannot be smuggled: a body like `{"$set": {"role": "admin"}}` passed as a Mongo update doc (see `db-mongo.md`).
- [ ] Server-owned fields are set by the server after validation: `ownerId = session.userId`, `tenantId = ctx.tenantId`.

## Severity guide

- Read of other users' PII / private data by any logged-in user: **High**; at scale or unauthenticated: **Critical**.
- Write/delete of other users' data: **High** (Critical if money, auth credentials or tenant-wide).
- Self-escalation to admin via mass assignment or BFLA: **Critical** if it leads to platform admin, otherwise **High**.
- Cross-tenant read/write: **Critical** when systemic, **High** for a single endpoint.
