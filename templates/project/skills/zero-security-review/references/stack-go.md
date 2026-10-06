# Stack: Go (net/http, chi, gin, echo, fiber; database/sql, sqlx, GORM, Mongo driver)

## Locate the protection layer

```bash
grep -rnE "\.Use\(|\.Group\(|\.With\(|middleware|http\.Handle(Func)?\(|ListenAndServe|http\.Server\{" --include=*.go .
grep -rnE "net/http/pprof|InsecureSkipVerify|math/rand|exec\.Command|template\.HTML|text/template|ParseUnverified|fmt\.Sprintf\(.*(SELECT|INSERT|UPDATE|DELETE|WHERE|ORDER)" --include=*.go <scope>
```

## Routing and middleware

- [ ] New routes registered on the intended group: `admin := r.Group("/admin", AuthRequired(), AdminOnly())` then `admin.POST(...)`. A route added to `r` instead of `admin` silently skips the middleware (BFLA).
- [ ] chi: `r.With(mw).Get(...)` vs `r.Group(func(r chi.Router){ r.Use(mw) ... })` scoping; `r.Use` must come before routes on that router.
- [ ] Auth middleware stores the identity in `context` with an unexported key type; handlers read it from context, never from headers/query.
- [ ] Recovery middleware present (gin `gin.Default()` includes it; custom engines may not). net/http recovers handler panics per connection but logs; goroutines spawned from handlers are not recovered (crash = DoS).
- [ ] `net/http/pprof` imported only on a separate, non-public mux/port (import registers on `http.DefaultServeMux`).

## Server hardening

- [ ] `http.Server` sets `ReadHeaderTimeout` (Slowloris), `ReadTimeout`, `WriteTimeout`, `IdleTimeout`; bare `http.ListenAndServe` has none (Medium on public services).
- [ ] Request size: `http.MaxBytesReader(w, r.Body, n)`; gin/echo body limits.
- [ ] `r.ParseMultipartForm(maxMemory)` with a sane cap; file size checked.

## Binding and validation

- [ ] `json.NewDecoder(r.Body)` + `dec.DisallowUnknownFields()` when strict input is required.
- [ ] Decode into **request structs**, not DB models (mass assignment of `Role`, `OwnerID`, `TenantID`). gin `c.ShouldBindJSON(&req)`; echo `c.Bind` binds **path, query and body** into the same struct, so a query param can set fields: use explicit `echo.BindBody`/separate structs.
- [ ] Validation tags (`binding:"required,max=100"`, go-playground/validator `validate.Struct`) present and errors checked.
- [ ] Integer parsing: `strconv.Atoi` errors handled; conversions to smaller ints (`int32(x)`) checked for overflow.

## SQL

- [ ] `database/sql`/`sqlx`/pgx: placeholders (`$1` for Postgres, `?` for MySQL) with args; never `fmt.Sprintf` or `+` into `Query`/`Exec`/`QueryRow`.
- [ ] Identifiers (`ORDER BY`, columns) from an allowlist map; `sqlx.In` for IN lists.
- [ ] GORM: `db.Where("name = ?", name)` is safe; `db.Where(fmt.Sprintf(...))`, `db.Raw(concat)`, `db.Order(userInput)`, `db.Select(userInput)`, `db.Group(userInput)` are injectable. GORM also treats a **string** passed as the primary-key argument as SQL (`db.First(&u, userInput)` with a string → injection): convert to int/UUID first.
- [ ] `rows.Close()` and `rows.Err()` handled (resource exhaustion, silent partial results).

## MongoDB driver

- [ ] Filters built as `bson.M{"email": req.Email}` where `req.Email` is a typed `string` field are safe. Decoding JSON into `map[string]interface{}`/`bson.M` and passing it as a filter or update allows operator injection (`{"$ne": ""}`, `$where`).
- [ ] Updates use explicit `bson.M{"$set": bson.M{"name": req.Name}}`, never a client map.

## Command, path, templates

- [ ] `exec.Command(bin, args...)` with a fixed binary; never `exec.Command("sh", "-c", userString)`; `--` before user args.
- [ ] Paths: `filepath.Join` + `filepath.Clean` does not contain traversal by itself. Use `os.Root`/`os.OpenInRoot` (Go ≥ 1.24) or `filepath.IsLocal` (≥ 1.20) + prefix check after `filepath.Abs`. `http.ServeFile` with user path; `http.FileServer` on a directory with secrets.
- [ ] HTML via `html/template` (contextual escaping), never `text/template` for HTML; no `template.HTML(user)`/`template.JS`/`template.URL` casts of user data.

## Crypto and auth

- [ ] `crypto/rand` for tokens, never `math/rand` (or `math/rand/v2` for secrets).
- [ ] `subtle.ConstantTimeCompare` / `hmac.Equal` for secrets.
- [ ] golang-jwt: `jwt.Parse(t, keyFunc, jwt.WithValidMethods([]string{"RS256"}), jwt.WithAudience(...), jwt.WithIssuer(...))`; keyFunc checks `token.Method`; no `ParseUnverified` for auth; check returned `err` **and** `token.Valid`.
- [ ] `tls.Config{InsecureSkipVerify: true}` outside tests: High. `MinVersion: tls.VersionTLS12` or higher.
- [ ] bcrypt via `golang.org/x/crypto/bcrypt` (cost ≥ 10) or argon2id.

## Concurrency

- [ ] Shared maps written from handlers without a mutex → `fatal error: concurrent map writes` (DoS) and data races; recommend `go test -race` on the related package (do not run the whole suite).
- [ ] Check-then-act on DB rows across goroutines/instances: see `business-logic.md`.

## Errors and data exposure

- [ ] `http.Error(w, err.Error(), 500)` / `c.JSON(500, gin.H{"error": err.Error()})` leaks driver/SQL messages: map to safe messages.
- [ ] Response structs separate from models; `json:"-"` on secret fields of models that are ever encoded.

## SSRF

- [ ] `http.Get(userURL)` / default client: no timeout (`http.Client{Timeout}`), follows redirects, no IP filtering. Use a `net.Dialer{Control: …}` that rejects private/loopback/link-local IPs at connect time and a `CheckRedirect` that re-validates.

## Tooling

- [ ] `govulncheck ./...` when `go.mod`/`go.sum` changed (see `dependencies.md`).
