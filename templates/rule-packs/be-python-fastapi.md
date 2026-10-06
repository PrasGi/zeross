# FastAPI rules

Applies to: Python backends on FastAPI or Starlette (Pydantic v2).

> Strictness follows `rules.strictness`; comments follow `rules.commentPolicy` (Google-style docstrings); tests follow `rules.testPolicy`. Read with `be-core.md`.

## Style

- Type hints on every function signature. **No bare `Any`** without a reason. Code must pass the project's `ruff` and `mypy`/`pyright` config.
- No bare `except:`. Catch specific exceptions and re-raise with context (`raise X from err`).
- Use `pathlib`, f-strings and context managers for resources.

## Structure

- Use `APIRouter` per domain (`routers/orders.py` → `services/orders.py` → `repositories/orders.py`), with Pydantic schemas in `schemas/`. Follow the existing layout.
- Route functions stay thin: dependencies, validation, call the service, `response_model`.
- Use dependency injection with `Depends` for the DB session, current user, permissions and settings. Annotate with `Annotated[..., Depends(...)]` per the project's style.
- Settings come from `pydantic-settings` `BaseSettings`, loaded once and cached (`lru_cache`). Never `os.environ` deep in code.

## Validation and schemas

- Use separate request and response models (`OrderCreate`, `OrderUpdate`, `OrderOut`). Always set `response_model` (or a return annotation) so internal fields never leak.
- `model_config = ConfigDict(extra="forbid")` on request models. Use `Field` constraints (`min_length`, `ge`, `le`, `pattern`) and `Literal`/`Enum` for enums.
- Cap pagination with `Query(le=MAX)`. Validate path IDs with types (UUID, int) or validators.
- Never accept `owner_id`, `role` or `tenant_id` from the client. Set them from the authenticated user.

## Auth

- Get the current user through a `Depends(get_current_user)` dependency. Check permissions in a dependency or the service, and check resource ownership on every ID-based route.
- JWT: use a standard library (`pyjwt`, `python-jose`, `authlib`) with the algorithm pinned and `exp`/`aud`/`iss` verified. Hash passwords with `passlib`/`pwdlib` (bcrypt or argon2).

## Async correctness

- In `async def` routes, **never call blocking I/O**: sync DB drivers, `requests`, `time.sleep`, heavy CPU work. Use async drivers (asyncpg, SQLAlchemy async, motor/pymongo async, httpx.AsyncClient), or a plain `def` route, or `run_in_threadpool`.
- Share clients (httpx, DB engine) through the lifespan, not one per request. Set timeouts on every outbound call.
- Background work: use the project's queue (Celery, RQ, arq, Dramatiq). Use `BackgroundTasks` only for short, non-critical, idempotent work.

## Errors

- Raise domain exceptions and map them to the project's error shape with `app.exception_handler`. Use `HTTPException` with precise status codes in routers.
- Don't leak DB errors or tracebacks. Map `IntegrityError` and duplicate keys to `409`.

## Data access

- SQLAlchemy 2.0 style (`select()`, `session.execute`). Bound parameters only; never f-string SQL (`text()` with `:params`).
- Use one session per request through a dependency. Transactions with `async with session.begin()`. Load relations explicitly (`selectinload`) to avoid N+1.
- Alembic migrations are backward compatible and reversible (see `db-postgres.md`/`db-mysql.md`).

## Testing

- pytest with `httpx.AsyncClient(transport=ASGITransport(app=app))` or `TestClient`. Swap dependencies with `app.dependency_overrides` (and clear them after).
- Fixtures in `conftest.py`. Use a transactional test DB (rollback per test) or a container. Use factories for data.
- Per route, cover: valid, invalid (422), unauthenticated (401), forbidden or another tenant (403/404), not found, conflict.
- Run single files only: `pytest tests/test_orders.py -k create`, per `project.apps[].test.command`. Never `--cov` unless asked.
