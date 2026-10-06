# AuthN: authentication, sessions, tokens

Goal: an attacker cannot become someone else, stay logged in after they should not, or skip a factor.
ASVS V2 (authentication), V3 (session management).

## Find the code

Run greps on the scoped files (or the module), not the whole repo, unless the scope is `full`.

```bash
grep -rnE "jwt\.(sign|verify|decode)|jsonwebtoken|jose|PyJWT|golang-jwt|jjwt|Jwts\.|firebase/php-jwt|tymon/jwt" -I .
grep -rnE "bcrypt|argon2|scrypt|pbkdf2|Hash::make|make_password|PasswordEncoder|md5\(|sha1\(|createHash\(['\"](md5|sha1|sha256)" -I .
grep -rnEi "otp|mfa|2fa|totp|bypass|skip_?verif|magic.?code|verification_?code" -I .
grep -rnEi "session\.(regenerate|destroy)|req\.session|request\.session|session\(\)->|logout|signOut|revoke" -I .
grep -rnEi "localStorage\.(setItem|getItem)\(.*(token|jwt|auth)" -I .
```

## JWT

- [ ] Verified, never just decoded. Smells: `jwt.decode(` used to authorize (Node `jsonwebtoken.decode` does not verify), PyJWT `options={"verify_signature": False}`, golang-jwt `ParseUnverified`, jjwt `parse()`/`parseClaimsJwt()` (unsigned) instead of `parseClaimsJws()`/`parseSignedClaims()`.
- [ ] Algorithm pinned on verify: Node `jwt.verify(t, key, { algorithms: ['RS256'] })`; PyJWT `jwt.decode(t, key, algorithms=["RS256"])`; golang-jwt `jwt.WithValidMethods([]string{"RS256"})` or keyfunc checks `token.Method.(*jwt.SigningMethodRSA)`. Missing pin → `alg: none` or RS→HS key confusion (public key used as HMAC secret).
- [ ] `exp` enforced (no `ignoreExpiration: true`, no huge `clockTolerance`); `aud` and `iss` checked when tokens come from an IdP or are shared across services.
- [ ] HS256 secret ≥ 256 bits from env/secret manager. Critical smell: `process.env.JWT_SECRET || 'secret'`, `os.getenv("SECRET", "changeme")`.
- [ ] Header-driven key lookup is safe: `kid` used as a map key only (never in a path or SQL), `jku`/`x5u` ignored or allowlisted.
- [ ] Claims used for authz (`role`, `tenantId`) come from a token the server signed; never from an unsigned cookie or a client-editable profile.
- [ ] Access tokens short-lived (≤15–60 min). Refresh tokens rotated on use, reuse detected (revoke the family), stored hashed server-side, bound to user and device.
- [ ] Revocation exists for logout, password change, role change and account disable (denylist by `jti`, token version on user, or session table).

## Sessions and cookies

- [ ] Session ID rotated on login and privilege change (fixation). Express: `req.session.regenerate()`; Laravel: `$request->session()->regenerate()`; Django `login()` rotates; Spring Security `sessionFixation().migrateSession()` (default).
- [ ] Logout destroys the server session (`req.session.destroy`, `session()->invalidate()`, `logout()`), not just the client cookie.
- [ ] Cookie flags: `HttpOnly`, `Secure`, `SameSite=Lax` or `Strict`, narrow `Domain`/`Path`; `__Host-` prefix for session cookies when possible.
- [ ] Idle and absolute timeouts exist.
- [ ] Tokens are not in `localStorage`/`sessionStorage` (stolen by any XSS). If an SPA must hold a token, keep it in memory and refresh via httpOnly cookie. Rate this Medium unless an XSS exists (then it raises that finding's impact).
- [ ] Tokens never in URLs (query strings land in logs, history, `Referer`), except single-use, short-lived links.

## Passwords

- [ ] Hash with argon2id (preferred), bcrypt (cost ≥ 10, 12 typical) or scrypt. Never MD5/SHA-1/SHA-256 alone, never reversible encryption.
- [ ] bcrypt truncates input at 72 bytes; pre-hashing must be done carefully (HMAC-SHA256 + base64), not raw.
- [ ] Compare via the library verify function (`bcrypt.compare`, `password_verify`, `check_password`, `PasswordEncoder.matches`), never `==` on hashes.
- [ ] Minimum length ≥ 8 (ASVS: 12 recommended), no maximum below 64, no composition rules required; breached-password check is a plus.
- [ ] Password change requires the current password (or a recent re-auth) and revokes other sessions.

## Reset, verification, magic links, invites

- [ ] Token: CSPRNG ≥ 128 bits, single-use, expires (≤ 1 h for reset), stored hashed, bound to user and purpose.
- [ ] Response is identical for known and unknown emails (no enumeration); timing roughly equal.
- [ ] Reset link built from a configured base URL, not the request `Host` / `X-Forwarded-Host` header (host-header poisoning sends the token to the attacker).
- [ ] Email change requires re-verification of the new address and notifies the old one.

## OTP / MFA

- [ ] Bypass flags and magic codes (`BYPASS_OTP_VERIFICATION`, `SKIP_OTP`, `OTP_BYPASS`, `MAGIC_OTP`, fixed `000000`/`123456`/`111111`) are honored **only** when the environment is local/test, and **fail closed**: unset or unknown env means no bypass. Smell: `if (env !== 'production') bypass()` (staging and misconfigured prod pass). Safe: `if (config.env === 'local' && config.bypassOtp === true)`, plus a startup assertion that refuses to boot with the flag on in non-local envs. Reachable outside local = High; in production config = Critical.
- [ ] OTP: CSPRNG, ≥ 6 digits, expires (≤ 5–10 min), single-use, bound to user and purpose (login vs reset vs payment), invalidated after N (≤ 5) failed attempts. Without attempt limits a 6-digit code falls to 10^6 requests: High.
- [ ] OTP send endpoint rate-limited per destination and per IP (SMS cost abuse, spam).
- [ ] MFA cannot be skipped by calling the post-MFA endpoint directly: the session carries a "MFA pending" state and every protected route checks "MFA complete".
- [ ] Disabling MFA or changing the MFA device requires re-auth.

## Login

- [ ] Rate limit / lockout per account and per IP, with backoff (see `business-logic.md`).
- [ ] Same message for "no such user" and "wrong password".
- [ ] Disabled/locked/unverified users are rejected at login **and** on token refresh.

## OAuth / OIDC / SSO

- [ ] `state` generated, stored, checked (CSRF on callback). PKCE for public clients.
- [ ] `redirect_uri` exact-match allowlist on the provider and in the app.
- [ ] ID token: signature, `iss`, `aud` (= our client id), `exp`, `nonce` verified.
- [ ] Account linking keyed on provider `sub`, not on an unverified email. Auth.js `allowDangerousEmailAccountLinking: true` is a smell.
- [ ] Client secret not in client code.

## API keys and service auth

- [ ] Stored hashed (SHA-256 is fine for high-entropy keys), shown once, prefixed for scanning, scoped, revocable.
- [ ] Compared timing-safe (see `crypto.md`).
- [ ] Internal service-to-service endpoints are not reachable from the public router, or require mTLS/signed tokens. "Internal" by path prefix alone is not auth.
