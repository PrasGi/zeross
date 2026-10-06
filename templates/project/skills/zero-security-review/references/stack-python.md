# Stack: Python (FastAPI, Django / DRF, Flask)

## Locate the protection layer

```bash
grep -rnE "add_middleware|CORSMiddleware|Depends\(|dependencies=\[|APIRouter\(|include_router|MIDDLEWARE|REST_FRAMEWORK|DEFAULT_(PERMISSION|AUTHENTICATION)_CLASSES|ALLOWED_HOSTS|DEBUG\s*=|SECRET_KEY|before_request|login_required" --include=*.py .
grep -rnE "shell=True|os\.system|os\.popen|pickle\.loads?|yaml\.load\(|eval\(|exec\(|render_template_string|mark_safe|\|safe|autoescape|\.raw\(|\.extra\(|RawSQL|cursor\.execute\(f|text\(f|verify=False|random\.|hashlib\.(md5|sha1)|verify_signature|tarfile|extractall|send_file|mktemp" --include=*.py <scope>
```

## FastAPI

- [ ] Auth dependency on every protected route: per route `Depends(get_current_user)`, or router-level `APIRouter(dependencies=[Depends(...)])`, or app-level. Check that new routes are on the protected router (`include_router` with dependencies) and not on a public one.
- [ ] Authorization inside the endpoint/service (ownership, role) using the user from the dependency, never from the body.
- [ ] Request models: pydantic models with constraints (`Field(max_length=…, ge=…)`, `constr`, `conint`, `EmailStr`, `Literal`/`Enum`); `model_config = ConfigDict(extra="forbid")` (pydantic v2; v1: `class Config: extra = "forbid"`) where unknown fields matter. Default is `ignore`, which is fine unless the code uses `**request.dict()` / `model_dump()` into ORM models that contain sensitive columns.
- [ ] Body typed as `dict`, `Any`, `Request.json()` used directly: unvalidated input (and NoSQL operator injection with Mongo).
- [ ] `response_model` (or return type annotation) set on endpoints returning ORM objects; otherwise every attribute is serialized (hashes, internal fields).
- [ ] `CORSMiddleware(allow_origins=["*"], allow_credentials=True)`: Starlette reflects the request origin for credentialed requests → treat as reflected origin with credentials (High on private data). `allow_origin_regex` must be anchored.
- [ ] `TrustedHostMiddleware` / proxy headers (`--proxy-headers`, `forwarded_allow_ips`) configured deliberately.
- [ ] File uploads (`UploadFile`): size read with a cap, content-type sniffed, filename not used as a path.
- [ ] Background tasks and async code: `await` between check and write is a race window (see `business-logic.md`).
- [ ] Docs (`/docs`, `/redoc`, `/openapi.json`) disabled or protected in production if the API is private (Info/Low).

## Django and DRF

- [ ] Settings for production: `DEBUG = False`, `ALLOWED_HOSTS` not `["*"]`, `SECRET_KEY` from env (no default), `SESSION_COOKIE_SECURE`, `CSRF_COOKIE_SECURE`, `SECURE_HSTS_SECONDS`, `SECURE_PROXY_SSL_HEADER` only behind a proxy that sets it, `X_FRAME_OPTIONS`.
- [ ] DRF `DEFAULT_PERMISSION_CLASSES` defaults to `AllowAny` when unset: verify settings, then every view's `permission_classes`. `AllowAny`, `authentication_classes = []`, `@permission_classes([AllowAny])` must be deliberate.
- [ ] IDOR: `get_queryset()` filters by `request.user`/tenant (not `Model.objects.all()`); `get_object()` relies on that queryset; object permissions (`has_object_permission`) are only called by `get_object()`, not by custom lookups or list views.
- [ ] Serializers: explicit `fields` (no `__all__`), `read_only_fields` for `owner`, `is_staff`, `is_superuser`, `role`, `tenant`; `HiddenField(default=CurrentUserDefault())` for ownership; nested writable serializers reviewed.
- [ ] Function views: `@login_required` / `@permission_required` / `user_passes_test`; class views: `LoginRequiredMixin` first in MRO.
- [ ] CSRF: `@csrf_exempt` only for token-authenticated or signature-verified endpoints. DRF `SessionAuthentication` enforces CSRF, `TokenAuthentication` does not need it.
- [ ] SQL: ORM is safe; `raw()`, `extra()`, `RawSQL`, `cursor.execute(f"…")` / `%` formatting are not. Use `cursor.execute(sql, params)` and `params=` on `raw()`.
- [ ] XSS: `mark_safe`, `format_html` misuse, `|safe`, `{% autoescape off %}`, `SafeString`.
- [ ] Open redirect: `next` parameter validated with `url_has_allowed_host_and_scheme`.
- [ ] Throttling (`DEFAULT_THROTTLE_CLASSES`/per-view) on auth and OTP endpoints.
- [ ] Admin: not on default `/admin/` without strong auth/MFA if internet-facing (Low/Info).
- [ ] Mass `update()`/`bulk_update()` from user dicts: `Model.objects.filter(...).update(**request.data)` is mass assignment.

## Flask

- [ ] `app.run(debug=True)` or `FLASK_DEBUG=1` in a deployed env: Werkzeug debugger console → RCE (Critical).
- [ ] `SECRET_KEY` strong from env (signed session cookies are forgeable otherwise); `SESSION_COOKIE_SECURE/HTTPONLY/SAMESITE`.
- [ ] Every route has auth (`@login_required` or `before_request` with explicit allowlist).
- [ ] `render_template_string(user)` (SSTI), `Markup(user)`, `send_file(user_path)` / `send_from_directory` with unchecked paths.
- [ ] Flask-WTF/CSRFProtect for cookie-auth forms.

## SQLAlchemy

- [ ] `session.execute(text("… :id"), {"id": x})` is safe; `text(f"…{x}")`, `.filter(text(f…))`, string `order_by(user)`, `literal_column(user)` are not.
- [ ] Tenant filters on every query (consider `with_loader_criteria` / session events for central enforcement).

## Generic Python sinks

- [ ] `subprocess.run([...])` without `shell=True`; never `os.system`/`os.popen` with user input; `shlex.quote` only as a last resort.
- [ ] `pickle`, `marshal`, `shelve`, `jsonpickle`, `yaml.load` (without `SafeLoader`), `dill` on untrusted data: Critical.
- [ ] `eval`/`exec`/`compile`/`__import__` with user input; `ast.literal_eval` is fine.
- [ ] Paths: `os.path.join(base, name)` discards `base` when `name` is absolute; resolve and use `Path.is_relative_to`. `tarfile.extractall` (use `filter="data"` on 3.12+), `zipfile` entry paths.
- [ ] XML: `defusedxml` for untrusted XML; lxml `resolve_entities=False`, `no_network=True`.
- [ ] `requests`/`httpx` with `verify=False`; no `timeout=` (hangs); SSRF on user URLs.
- [ ] `random` for tokens (use `secrets`), `hashlib.md5/sha1` for passwords (use argon2-cffi/bcrypt/passlib), `hmac.compare_digest` for secret compares.
- [ ] PyJWT: `jwt.decode(token, key, algorithms=["HS256"], audience=..., issuer=...)`; `options={"verify_signature": False}` / `verify_exp: False` used for auth = Critical/High.
- [ ] `tempfile.mktemp` (race), world-writable files, `os.chmod(…, 0o777)`.
- [ ] Logging: `logger.info(request.data)` / f-strings with tokens.

## Tooling

- [ ] `pip-audit` for changed requirements (see `dependencies.md`); `bandit -r <scope>` is a useful lead generator if installed (verify every hit, never report raw).
