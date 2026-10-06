# Stack: PHP / Laravel

## Locate the protection layer

```bash
cat routes/api.php routes/web.php | head -200              # middleware groups, auth:sanctum, can:, throttle:
grep -rnE "middleware\(|withoutMiddleware|->can\(|Gate::|authorize\(|Policy|\\\$except|validateCsrfTokens|TrustProxies|trustProxies" app routes bootstrap config
grep -rnE "\\\$guarded\s*=\s*\[\s*\]|\\\$fillable|->all\(\)|forceFill|forceCreate|DB::raw|whereRaw|selectRaw|orderByRaw|havingRaw|DB::(select|statement|unprepared)|unserialize|eval\(|exec\(|system\(|passthru|shell_exec|proc_open|popen|\`|include \\\$|require \\\$|file_get_contents\(\\\$|\{!!|getClientOriginalName|md5\(|sha1\(|rand\(|mt_rand|uniqid|==\s*\\\$" app routes resources config
```

Laravel 11+ registers middleware in `bootstrap/app.php`; older versions use `app/Http/Kernel.php`.

## Authentication and routes

- [ ] Protected routes inside `Route::middleware(['auth:sanctum'])` / `auth` groups; no accidental `withoutMiddleware('auth')`; new routes added to the right file and group.
- [ ] Sanctum: SPA cookie mode needs `SANCTUM_STATEFUL_DOMAINS` exact and CSRF cookie flow; token abilities checked (`tokenCan`) for scoped tokens.
- [ ] `Auth::loginUsingId($id)` / `Auth::login($user)` only after real verification; impersonation features gated to admins and audited.
- [ ] `throttle:` middleware on login, OTP, password reset and registration routes (`RateLimiter::for` keyed by user/email + IP).
- [ ] Session regenerated on login (`$request->session()->regenerate()`) and invalidated on logout (`invalidate()` + `regenerateToken()`).

## Authorization

- [ ] Every controller action acting on a model calls a Policy/Gate (`$this->authorize('update', $post)`, `Gate::authorize`, `can:` route middleware, `@can` is only UI).
- [ ] Route model binding (`/posts/{post}`) resolves **any** row by ID: ownership must be checked (Policy) or bindings scoped (`->scopeBindings()` for nested resources, or `Post::where('user_id', auth()->id())->findOrFail($id)`).
- [ ] FormRequest `authorize()` is not a blanket `return true` when the request targets someone's object.
- [ ] Multi-tenant: global scopes (`addGlobalScope`) applied to tenant models; `withoutGlobalScopes()` usage reviewed.

## Mass assignment

- [ ] `$guarded = []` or `Model::unguard()`: every column is fillable. `$fillable` must not include `role`, `is_admin`, `user_id`, `tenant_id`, `balance`, `email_verified_at`.
- [ ] Use `$request->validated()` (or `safe()->only([...])`), never `$request->all()` / `$request->input()` into `create`/`update`/`fill`; `forceFill`/`forceCreate` only with server values.
- [ ] Livewire: public properties are client-tamperable; mark sensitive ones `#[Locked]` and authorize in actions.

## Validation

- [ ] FormRequest or `$request->validate()` on every input, with `max:` on strings, `integer|min:|max:`, `in:` enums, `exists:` scoped (`Rule::exists('posts', 'id')->where('user_id', …)`), `array|max:` for arrays.
- [ ] Uploads: `file|mimes:jpg,png|mimetypes:image/jpeg,image/png|max:<kb>`; stored with `store()`/`storeAs()` with a generated name on a non-public disk, never `getClientOriginalName()` as the path; nothing under `public/` that PHP could execute.

## Injection

- [ ] Query Builder/Eloquent bind values; raw methods do not: `DB::raw`, `whereRaw`, `selectRaw`, `orderByRaw`, `havingRaw`, `DB::select("… $x")`, `DB::statement`, `DB::unprepared` must use `?` bindings (`whereRaw('price > ?', [$p])`).
- [ ] Column names are not bound: `orderBy($request->sort)`, `->where($request->field, …)`, `select($request->columns)` need an allowlist.
- [ ] Commands: `exec`/`system`/`passthru`/`shell_exec`/backticks/`proc_open` with user input; `Process::run([...])` with an array; `escapeshellarg` only as a last resort.
- [ ] `include`/`require` with variables (LFI/RFI); `file_get_contents`/`fopen` with user paths or URLs (SSRF, `phar://`, `php://filter`).
- [ ] `unserialize($user)` → use `json_decode`, or `unserialize($x, ['allowed_classes' => false])`.
- [ ] `Http::get($userUrl)` / Guzzle: SSRF controls (see `injection.md`).
- [ ] Blade `{!! $x !!}` only on sanitized/trusted HTML (HTMLPurifier/`mews/purifier`); `{{ }}` escapes.
- [ ] `Blade::render($userTemplate)`, `eval`, `create_function`, `preg_replace` with `/e`: Critical.

## PHP language traps

- [ ] Loose comparison `==` with user input: `"0e123" == "0e456"` is true, `"abc" == 0` is true on PHP < 8, `null == false`. Use `===`, `hash_equals` for secrets, `in_array($x, $arr, true)`, `array_search(..., true)`, `switch` uses loose comparison.
- [ ] `md5`/`sha1` for passwords; use `Hash::make` / `password_hash` (bcrypt/argon2id) and `Hash::check`.
- [ ] `rand`, `mt_rand`, `uniqid`, `str_shuffle` for tokens; use `random_bytes`, `random_int`, `Str::random`.
- [ ] `extract($_GET/$request->all())`, variable variables from input.

## Config and secrets

- [ ] `APP_DEBUG=false` and `APP_ENV=production` in deployed envs (Ignition/whoops page leaks env; old Ignition had RCE CVE-2021-3129).
- [ ] `APP_KEY` never committed; a leaked key enables cookie decryption/forgery and deserialization attacks: rotate.
- [ ] CSRF: `VerifyCsrfToken::$except` / `validateCsrfTokens(except: [...])` only for signature-verified webhooks.
- [ ] `TrustProxies` `$proxies = '*'` only behind a trusted load balancer.
- [ ] Telescope, Horizon, Debugbar, `/_ignition` not exposed in production (gate + env).
- [ ] Signed URLs verified (`hasValidSignature()` / `signed` middleware) for email verification, unsubscribe, downloads.
- [ ] CORS `config/cors.php`: `allowed_origins` not `['*']` with `supports_credentials => true`.

## Data exposure

- [ ] API responses through API Resources or `$hidden` (`password`, `remember_token`, `two_factor_secret`); returning models directly serializes every visible attribute and loaded relations.
- [ ] `Log::info($request->all())` logs passwords/tokens.

## Tooling

- [ ] `composer audit` when `composer.json`/`composer.lock` changed.
