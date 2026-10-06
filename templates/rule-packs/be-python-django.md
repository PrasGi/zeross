# Django rules

Applies to: Python backends on Django, with or without Django REST Framework (DRF) or Django Ninja.

> Strictness follows `rules.strictness`; comments follow `rules.commentPolicy` (docstrings); tests follow `rules.testPolicy`. Read with `be-core.md`.

## Style and structure

- Type hints on new functions. Code must pass the project's `ruff` and `mypy` (django-stubs) config. No bare `except:`.
- Use one Django app per domain. Business logic lives in a service layer (`services.py`) or model methods, following the project's choice, not in views or serializers.
- Settings come from env (`django-environ` or `os.environ` in settings only). Never read env in app code. Never ship `DEBUG=True` or `ALLOWED_HOSTS=['*']` in non-local settings.

## Validation

- **DRF:** a serializer per use case (`OrderCreateSerializer`, `OrderReadSerializer`). Use **explicit `fields`**, never `fields = "__all__"`, and `read_only_fields` for `id`, `owner`, `tenant`, `status` and similar.
- **Forms:** use `ModelForm` with explicit `fields`. Never set `exclude` to "everything but".
- **Ninja:** Pydantic schemas with `extra="forbid"`.
- Validate path and query params, and cap pagination (`max_page_size` on pagination classes).
- Set owner and tenant from `request.user` in `perform_create` or the service, never from input.

## Auth and permissions

- Every view sets `permission_classes` (DRF) or `@login_required`/`LoginRequiredMixin`, unless it is explicitly public. Check the `DEFAULT_PERMISSION_CLASSES` defaults first.
- **Object-level permissions:**
  - scope `get_queryset()` to the user or tenant, so other users' objects return 404
  - add `has_object_permission` checks for privileged actions
  - never fetch with `Model.objects.get(pk=…)` without that scope
- Keep CSRF protection on for session auth. Use `@csrf_exempt` only for signed webhooks, with signature verification.

## ORM

- Avoid N+1: `select_related` for FK/one-to-one and `prefetch_related` for reverse/M2M relations in list endpoints. Check the query count in tests (`assertNumQueries`).
- `transaction.atomic()` for multi-step writes. `select_for_update()` for check-then-act. `F()` expressions for counters.
- Use `transaction.on_commit()` for side effects: emails, tasks, webhooks.
- Raw SQL: `cursor.execute(sql, params)` or `.raw(sql, params)` with params only. Never `%`/f-string formatting. Never `.extra()` with user input.
- `.only()`/`.values()` for heavy listings. `.exists()` instead of `len(qs)`/`count()` for presence checks. `.iterator()` for big batches.

## Migrations

- Every model change ships a generated migration. Review it, and never edit applied ones.
- Use the expand/contract pattern: add a nullable field, backfill with `RunPython` (with a reverse function) in batches, then add the constraint.
- Flag `AddIndex` on large tables. Use `AddIndexConcurrently` (Postgres) with `atomic = False`.

## Errors and responses

- DRF: raise `ValidationError`, `PermissionDenied`, `NotFound`, and use a custom `EXCEPTION_HANDLER` for the project's error shape.
- Never return model instances with sensitive fields. Always go through a serializer or schema.

## Async and tasks

- Celery (or the project's queue) for slow work. Tasks are idempotent, take IDs (not model instances), and re-fetch inside the task.
- Async views only with async-safe ORM calls (`aget`, `afilter`) or `sync_to_async`.

## Testing

- `pytest-django` (or `TestCase`) with factories (factory_boy). Use `APIClient`/`force_authenticate` for DRF.
- Per endpoint, cover: valid, invalid (400), unauthenticated (401/403), another user's object (404), permission denied, and the query count for lists.
- Run single files only: `pytest apps/orders/tests/test_views.py -k create`, per `project.apps[].test.command`. Never `--cov` unless asked.
