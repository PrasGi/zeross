# NestJS rules

Applies to: NestJS backends (TypeScript).

> Strictness follows `rules.strictness`; comments follow `rules.commentPolicy` (TSDoc); tests follow `rules.testPolicy`. Read with `be-core.md`.

## Structure

- Use one feature module per domain (`users.module.ts`, `users.controller.ts`, `users.service.ts`, and a repository or data-access provider). Follow the app's existing module layout.
- Controllers are thin: route, DTO, guards and response mapping. Business logic lives in services. Persistence lives in repositories or ORM providers.
- Use constructor injection only. Inject interfaces through tokens when the project does. Never instantiate providers with `new` inside other providers.
- Avoid circular module dependencies. Refactor shared logic into a module instead of using `forwardRef` as a first resort.
- Configuration goes through `ConfigService` or typed config namespaces, validated at startup (Joi or zod schema). Never read `process.env` in services.

## Validation and DTOs

- Every body, query and param has a DTO class with `class-validator` decorators, or the project's zod pipe.
- Global `ValidationPipe` with `whitelist: true`, `forbidNonWhitelisted: true` and `transform: true`. Check `main.ts` before adding per-route pipes.
- Use `ParseUUIDPipe`, `ParseIntPipe` and `ParseEnumPipe` (or the project's ObjectId pipe) for path params.
- Response DTOs or serializers (`ClassSerializerInterceptor` with `@Exclude`/`@Expose`, or explicit mapping) so internal fields like `password` and `__v` never leak.
- **[strict]** Separate create and update DTOs. Use `PartialType`/`PickType`/`OmitType` from `@nestjs/mapped-types` (or `@nestjs/swagger`). Never accept `ownerId`, `role` or `tenantId` from the client.

## Auth

- Authenticate with guards (`AuthGuard`, a JWT strategy). Authorize with role or policy guards plus resource ownership checks in the service.
- Check for global guards (`APP_GUARD`) and `@Public()`-style decorators before adding guards. Mark public routes explicitly.
- Get the current user from the project's `@CurrentUser()` decorator or the request, never from the body.

## Errors

- Throw Nest HTTP exceptions (`NotFoundException`, `ForbiddenException`, `ConflictException`), or domain errors mapped by an exception filter, using the project's pattern.
- Map ORM and driver errors (unique violation, duplicate key) to `409` in a filter or the repository. Never surface raw ORM errors.

## Data access

- **TypeORM:** repositories or `DataSource`; `QueryRunner` or `dataSource.transaction()` for atomic writes; relations loaded explicitly (no lazy N+1).
- **Prisma:** the `PrismaService` singleton; `$transaction` for atomic writes; `select` only the needed fields.
- **Mongoose:** `@InjectModel`; `.lean()` for reads; sessions with `withTransaction` for multi-document writes (see `db-mongo.md`).
- Parameterized raw queries only (`query($1)`, `Prisma.sql`). Never interpolate.

## Async, events and jobs

- Always `await` or return promises. No floating promises; satisfy `@typescript-eslint/no-floating-promises`.
- Background work goes through the project's queue (BullMQ via `@nestjs/bullmq`, etc.). Handlers are idempotent and retry-safe.
- Emit events (`EventEmitter2`, CQRS) after the transaction commits.
- Lifecycle: close connections in `onModuleDestroy` and enable shutdown hooks.

## API docs

- When Swagger is used, decorate new endpoints and DTOs (`@ApiTags`, `@ApiOkResponse`, `@ApiProperty`) to match the existing coverage.

## Testing

- Unit tests: `Test.createTestingModule` with mocked providers (`useValue`). Test the service logic directly.
- Controller tests stay unit-level: `Test.createTestingModule` with the controller and mocked services, calling the handler directly. Test DTO validation by running the DTO through `ValidationPipe` (or `validate()` from `class-validator`) with the same options as `main.ts`, and guards by unit-testing `canActivate` with a mocked `ExecutionContext`.
  - Cover: valid, invalid DTO (400/422), unauthenticated (401), forbidden or another user's resource (403/404), not found, conflict.
- No new e2e suites (`supertest` against `app.getHttpServer()`, `test/*.e2e-spec.ts`) unless the user explicitly asks; see "No e2e test files" in `testing.md`. Update existing ones only when the change breaks them.
- Run single files only (e.g. `pnpm jest src/users/users.service.spec.ts`), using `project.apps[].test.command`.
