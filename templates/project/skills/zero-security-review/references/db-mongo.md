# Database: MongoDB (Mongoose, native drivers, Prisma-Mongo)

## Operator injection (the #1 Mongo bug)

JSON bodies and `qs`-parsed query strings can carry objects where the code expects strings.

```js
// Vulnerable: body = {"email":"victim@x.com","password":{"$ne":null}}
User.findOne({ email: req.body.email, password: req.body.password })
// Vulnerable: GET /users?role[$ne]=user   (Express extended query parser)
User.find({ role: req.query.role })
```

- [ ] Every filter value from input is type-checked as a scalar before use (validation schema with `z.string()`, `@IsString()`, pydantic `str`, typed Go/Java structs).
- [ ] Or wrapped: `{ email: { $eq: input } }`; or Mongoose `sanitizeFilter: true` (global `mongoose.set('sanitizeFilter', true)` or per query `.setOptions({ sanitizeFilter: true })`), which wraps nested `$` objects in `$eq`; or `express-mongo-sanitize` / `mongo-sanitize` stripping `$`- and `.`-prefixed keys.
- [ ] Mongoose `strictQuery`: when `true`, filter paths not in the schema are dropped; when `false` (Mongoose 7+ default), arbitrary paths go to the server. Not a substitute for type checks.
- [ ] Watch: `$ne`, `$gt`, `$gte`, `$in`, `$nin`, `$exists`, `$regex`, `$expr`, `$or`/`$and` arrays from input, `$where`.

## Server-side JavaScript

- [ ] No user input in `$where`, `$function`, `$accumulator`, `mapReduce` map/reduce functions: Critical (JS execution in the DB; also DoS). Prefer disabling server-side JS (`security.javascriptEnabled: false`).

## Update injection and mass assignment

```js
User.findByIdAndUpdate(id, req.body)               // body may contain role, or {"$set": {...}}, {"$unset": {...}}
User.updateOne({ _id: id }, { $set: req.body })    // body may contain "role", "tenantId", "profile.role"
```

- [ ] Updates built from an allowlisted DTO: `{ $set: { name: dto.name, bio: dto.bio } }`.
- [ ] Dotted keys (`"profile.role"`) and `$`-prefixed keys in user objects rejected.
- [ ] Mongoose `strict` mode not disabled on schemas holding sensitive fields (`strict: false` stores any key).
- [ ] `overwrite: true` / `replaceOne` with user documents.

## Regex

- [ ] `$regex: userInput` / `new RegExp(userInput)`: escape (`escapeStringRegexp`, `_.escapeRegExp`), cap length, prefer anchored prefix (`^` + escaped) for index use. Unescaped user regex = ReDoS and data enumeration (`^a`, `^ab`, …).

## Aggregation pipelines

- [ ] No user-provided stages or stage objects (`pipeline.push(req.body.stage)`); `$match` values type-checked as above.
- [ ] `$lookup` (and `$graphLookup`, `$unionWith`) sub-pipelines also apply tenant/owner filters; a lookup into another collection is a classic cross-tenant leak.
- [ ] `$out`/`$merge` never driven by user input.
- [ ] `$project` excludes sensitive fields; aggregation bypasses Mongoose `select: false` and `toJSON` transforms.

## Authorization at the query

- [ ] Owner/tenant in the filter of `find`, `findOne`, `findOneAndUpdate`, `updateMany`, `deleteMany`, `countDocuments`, `distinct`, `aggregate` (`$match` first): `{ _id: id, tenantId: ctx.tenantId }`.
- [ ] `findById(id)` is `findOne({ _id: id })`: no ownership. Prefer `findOne({ _id: id, ownerId })`.
- [ ] Central enforcement option: a Mongoose plugin that adds `tenantId` to all queries (`pre(/^find/)`, `pre('aggregate')`, `pre('updateOne')`...), with care for `aggregate` and `bulkWrite`.

## Data exposure

- [ ] Sensitive schema paths use `select: false` (`password`, `resetToken`, `otp`); code that needs them uses `.select('+password')` locally and never returns that document.
- [ ] `.lean()` results skip `toJSON` transforms/virtual hiding: map to a DTO before returning.
- [ ] Projections on list/search endpoints.

## IDs and errors

- [ ] Validate ObjectIds (`mongoose.isValidObjectId`, `ObjectId.isValid` + length check) before querying: invalid IDs cause `CastError` → 500 and leaked internals.
- [ ] Driver errors (`E11000 duplicate key … index: email_1 dup key: { email: "…" }`) not returned raw (leaks other users' data and schema).

## Atomicity and races

- [ ] Use atomic operators with conditions: `findOneAndUpdate({ _id, stock: { $gte: q } }, { $inc: { stock: -q } }, { new: true })`, check the result for null.
- [ ] Unique indexes for "only once" rules (partial/compound: `{ userId: 1, couponId: 1 }`, `unique: true`); `unique` in a Mongoose schema creates an index only if `autoIndex` ran: verify the index exists (migrations or `syncIndexes`).
- [ ] Case-insensitive uniqueness for emails: collation `{ locale: 'en', strength: 2 }` on the index or normalized lowercase field.
- [ ] Multi-document invariants: transactions (`session.withTransaction`, requires a replica set) or a single-document design.

## Limits and performance (DoS)

- [ ] `limit` capped; large `skip` replaced by range pagination for public endpoints.
- [ ] Unindexed filters on user-controlled fields on big collections; `allowDiskUse` on user-triggered aggregations; `maxTimeMS` on expensive queries.

## Connection and config

- [ ] Connection string from env (`config.db.envVar`), never in code; TLS on for remote clusters; `authSource` correct; app user least-privileged (no `root`/`dbAdminAnyDatabase`).
- [ ] Schema validation (`$jsonSchema` validator) for critical collections if the project uses it.

## Other drivers

- [ ] Python (PyMongo/Motor): filters from `request.json()` dicts; use pydantic models. Go: decoding into `bson.M`/`map[string]any` (see `stack-go.md`). Java: `Document.parse(userJson)`, `BasicQuery(userJson)`, Spring Data `@Query` with string concatenation.
- [ ] Prisma with Mongo: `$runCommandRaw`, `findRaw`, `aggregateRaw` with user input.
