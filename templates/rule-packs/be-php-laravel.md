# Laravel rules

Applies to: PHP backends on Laravel (PHP 8.2+).

> Strictness follows `rules.strictness`; comments follow `rules.commentPolicy` (PHPDoc); tests follow `rules.testPolicy`. Read with `be-core.md`.

## Style

- PSR-12, enforced with Laravel Pint (or the project's fixer). Use `declare(strict_types=1);` in new files when the project does.
- Explicit parameter and return types everywhere. **No `mixed`** without a reason. Must pass the project's PHPStan/Larastan level.
- Prefer `match` over `switch`, backed enums for fixed sets, and `readonly` properties for value objects.
- Never use `eval`, `extract`, `$$var`, or `env()` outside `config/*.php`. Read config with `config()`.

## Structure

- Controllers stay thin:
  - **Form Request** for validation and authorization
  - a service or action class for the logic
  - **API Resource** for the response
- Follow the project's existing split: Actions, Services or Repositories.
- Use route model binding with scoped bindings (`->scopeBindings()`) for nested resources.
- Dispatch a queued Job for anything slow (> ~200 ms, external calls, mail). Fire Events and Listeners for decoupled side effects.

## Validation and mass assignment

- **Every write endpoint uses a Form Request.** `rules()` covers type, format, length, `exists`/`unique` (scoped by tenant) and `Rule::enum`. Cap `per_page`.
- Use `$request->validated()` (or `safe()->only([...])`). **Never `$request->all()`** into `create`/`update`/`fill`.
- Models declare `$fillable` (preferred) or a tight `$guarded`. Never `$guarded = []` on models with sensitive columns. Never put `role`, `is_admin`, `tenant_id` or `owner_id` in a client-fillable path.

## Authorization

- Use Policies and Gates for every resource action: `$this->authorize()`, `Gate::authorize()`, `can` middleware, or `authorize()` in the Form Request.
- Scope queries to the current user or tenant (global scopes or explicit `where`). Route model binding alone doesn't check ownership.
- Protect auth, OTP and password-reset routes with rate limiting (`RateLimiter::for`, `throttle` middleware).
- Hash passwords with `Hash::make` (bcrypt or argon2). Compare tokens with `hash_equals`.

## Eloquent and DB

- Avoid N+1: eager-load with `with()`. Enable `Model::preventLazyLoading()` outside production when the project does.
- Use `DB::transaction()` for multi-step writes, `lockForUpdate()` for check-then-act, and `increment()` for counters.
- Raw queries only with bindings (`DB::select('… where id = ?', [$id])`, `whereRaw('x = ?', [$v])`). Never interpolate into `*Raw` methods.
- Use `chunkById()`/`lazyById()` for large batches. Use `select()` for the needed columns on heavy listings.
- **Migrations:** each one has a working `down()` or documents why not. Use expand/contract for renames and drops. Never edit a migration that has already run.

## Responses and errors

- Return API Resources (`JsonResource`) with explicit fields. Never return raw models: hidden attributes alone aren't a contract.
- Map domain exceptions in `bootstrap/app.php` `withExceptions` (or `Handler`) to the project's error shape. No stack traces when `APP_DEBUG=false`.
- Use correct status codes: `201` on create, `204` on delete, `409` on conflicts, `422` from validation.

## Security

- Blade: output with `{{ }}`. Use `{!! !!}` only for sanitized HTML.
- Keep CSRF on for web routes. Exclude only signed webhooks, and verify their signatures.
- File uploads: validate `mimes`/`mimetypes` and `max`, store on a non-public disk, and use generated names. Never execute or include uploads.

## Testing

- Use Pest (or PHPUnit, per the project), with factories (never seeders) and `RefreshDatabase`/`LazilyRefreshDatabase`.
- Feature tests per endpoint: valid, invalid (422 with `assertJsonValidationErrors`), unauthenticated (401), forbidden or another tenant (403/404), not found.
- Use fakes for side effects: `Queue::fake()`, `Mail::fake()`, `Event::fake()`, `Http::fake()`, `Storage::fake()`.
- Run single files only: `php artisan test tests/Feature/OrderTest.php --filter=create` or `vendor/bin/pest <file>`, per `project.apps[].test.command`.
