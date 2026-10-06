# Business logic, race conditions, abuse

Goal: the system's rules hold under concurrency, replay, tampering and automation, not just for
a well-behaved UI. ASVS V11 (business logic), V2.2 (anti-automation). Scanners miss these; read
the flow and ask "what if this request is sent twice, out of order, or with edited numbers?"

## Race conditions (check-then-act)

Pattern: read state, decide in application code, then write, with no atomicity.

```ts
const user = await User.findById(id);
if (user.balance >= amount) {                 // check
  user.balance -= amount; await user.save();  // act: two parallel requests both pass the check
}
```

Typical targets: balance/credit spend, coupon or voucher redemption, "one per user" claims,
inventory/seat booking, invite acceptance, referral rewards, username/email uniqueness, OTP
verification counters, withdrawal limits, vote/like counts, file quota.

Safe forms:

- [ ] Atomic conditional update; check the affected row count.
  - SQL: `UPDATE accounts SET balance = balance - $1 WHERE id = $2 AND balance >= $1 RETURNING balance`
  - Mongo: `updateOne({ _id, balance: { $gte: amt } }, { $inc: { balance: -amt } })` → check `modifiedCount === 1`
- [ ] Row lock in a transaction: `SELECT … FOR UPDATE` (Prisma `$transaction` + raw `FOR UPDATE`, Laravel `lockForUpdate()`, Django `select_for_update()`, JPA `@Lock(PESSIMISTIC_WRITE)`).
- [ ] Optimistic locking: version column (`@Version`, Mongoose `optimisticConcurrency`, `WHERE version = $n`).
- [ ] Unique constraints/indexes for "only once" rules (`UNIQUE (user_id, coupon_id)`); handle the duplicate-key error as the business error.
- [ ] Transaction isolation suits the invariant (Postgres default READ COMMITTED does not prevent write skew; use `SERIALIZABLE` or explicit locks when two rows must stay consistent).
- [ ] Distributed locks (Redis `SET NX PX`) have a TTL and fencing; not used as the only guard for money.
- [ ] Async code: `await` between check and write in Node/Python is a yield point; in-process mutexes do not protect across instances.

Dynamic proof (local only): fire N parallel identical requests (`curl … & curl … & wait` or
`xargs -P 10`) and read back the state.

## Idempotency and double submit

- [ ] Payment, order, transfer and "create" endpoints accept an idempotency key (header or client-generated ID) stored with a unique constraint; replays return the original result.
- [ ] Webhooks deduplicated by provider event ID before acting.
- [ ] UI disabling the button is not a control; the server must enforce.

## Tampering with values

- [ ] Prices, totals, discounts, fees, currency, tax and shipping are computed server-side from the catalog, never taken from the client (`body.price`, `body.total`, hidden form fields).
- [ ] Quantities: positive integers, max per order; negative quantity → refunds/credits.
- [ ] Money as integer minor units or decimal type; rounding rules explicit; currency checked against the account/order.
- [ ] Discount/coupon: validity window, usage limits, stacking rules, minimum order, applicable items, ownership (a user cannot use another user's personal code).
- [ ] Client flags trusted as facts: `paid: true`, `verified: true`, `isTrial`, `plan`, `discountPercent`, `skipPayment`.

## State machines and multi-step flows

- [ ] Transitions validated server-side against the current state (`pending → paid → shipped`); the update is conditional on the current state (`WHERE status = 'pending'`) to avoid races.
- [ ] Steps cannot be skipped by calling the final endpoint directly (checkout without payment confirmation, KYC submit without verification, onboarding completion).
- [ ] Payment confirmation comes from a verified provider callback or a server-to-server lookup, never from the client redirect alone.
- [ ] Cancel/refund only from allowed states and only once.
- [ ] Time-based rules use server time.

## Replay

- [ ] Webhooks: signature + timestamp tolerance (e.g. 5 min) + event-ID dedupe.
- [ ] One-time tokens (reset, magic link, invite, OTP, email verification) invalidated on use and on issuing a new one.
- [ ] Signed URLs and pre-signed uploads expire and are scoped.
- [ ] Nonces for any signed client requests.

## Rate limiting and anti-automation

- [ ] Login, OTP send, OTP verify, password reset request, signup, email/SMS sending, invite, search/export endpoints are rate-limited.
- [ ] Keyed by account/identifier **and** IP (IP-only is bypassed by rotation; account-only enables lockout DoS → use backoff or CAPTCHA, not hard lockout forever).
- [ ] Limiter storage shared across instances (Redis), not in-memory per process, in multi-instance deployments.
- [ ] Client IP derived from a trusted proxy configuration, not raw `X-Forwarded-For`.
- [ ] Expensive operations (report generation, PDF rendering, AI calls, imports) have quotas and size caps.

## Resource exhaustion

- [ ] Loops, allocations or fan-out sized by user input (`count`, `limit`, `depth`, array length) are capped.
- [ ] Pagination capped; no "export all" without background job and limits.
- [ ] GraphQL depth/complexity limits, batch size limits.
- [ ] Regex and parsing of large inputs bounded (see ReDoS in `injection.md`).

## Account and identity flows

- [ ] Email/phone change requires verification of the new value and re-auth; notifies the old one.
- [ ] Invite acceptance binds to the invited email; invite links single-use and expiring.
- [ ] Self-referral, multi-account farming of rewards guarded where money is involved.
- [ ] Account deletion/deactivation revokes sessions, tokens and API keys.

## Severity guide

Double spend or balance/credit minting: **Critical**. Price/quantity tampering accepted: **Critical**
(money) or **High**. Payment-step bypass: **Critical**. Coupon multi-use race: **High/Medium** by
value. Missing OTP verify limit: **High**. Missing login rate limit: **Medium**. Missing idempotency
on non-money creates: **Low**.
