# Spring Boot rules

Applies to: JVM backends on Spring Boot (Java 17+ or Kotlin).

> Strictness follows `rules.strictness`; comments follow `rules.commentPolicy` (Javadoc/KDoc); tests follow `rules.testPolicy`. Read with `be-core.md`.

## Style

- **Kotlin:**
  - `val` over `var`; data classes for DTOs; sealed classes for domain results
  - never `!!`: use `?.let`, `?:`, `requireNotNull`
  - coroutines with structured concurrency, never `GlobalScope`
- **Java:** records for DTOs and value objects; sealed interfaces; pattern matching; `Optional` only as a return type at boundaries.
- Code must pass the project's static analysis (Detekt, ktlint, Checkstyle, SpotBugs, Error Prone).

## Structure

- `@RestController` → `@Service` → repository (Spring Data or jOOQ/JdbcTemplate). Controllers stay thin.
- **Constructor injection only.** No field `@Autowired`. Use `final` fields in Java and `private val` in Kotlin.
- Keep the domain model free of web concerns. Map entities to and from DTOs explicitly (MapStruct or manual mapping). **Never expose JPA entities** in API responses or bind request bodies into entities.
- Typed config with `@ConfigurationProperties` plus `@Validated`. No hard-coded URLs, credentials or flags. Use profile-specific YAML.

## Validation

- `@Valid` on every `@RequestBody`, and `@Validated` on controllers that validate `@PathVariable`/`@RequestParam`.
- Bean Validation constraints on DTOs: `@NotBlank`, `@Size`, `@Email`, `@Positive`, `@Pattern`, and custom constraints for domain rules.
- Reject unknown JSON fields (`spring.jackson.deserialization.fail-on-unknown-properties=true`) when the project agrees. Cap `Pageable` size (`spring.data.web.pageable.max-page-size`).
- Never accept `id`, `ownerId`, `role` or `tenantId` from the request body for writes.

## Security

- Spring Security `SecurityFilterChain`:
  - deny by default
  - permit public routes explicitly
  - use `@PreAuthorize` (with `@EnableMethodSecurity`) for role or permission checks
- **Object-level authorization:** check ownership or tenancy in the service, or with `@PreAuthorize("@authz.canRead(#id, authentication)")`. Scope queries by tenant.
- Passwords use `PasswordEncoder` (BCrypt or Argon2). JWT goes through `spring-security-oauth2-resource-server` with issuer, audience and algorithm validated.
- CSRF stays enabled for cookie or session auth. CORS uses an explicit allowlist.

## Errors

- One `@RestControllerAdvice` maps domain exceptions to `ProblemDetail` (RFC 9457) or the project's error shape. Never return stack traces. Set `server.error.include-stacktrace=never`.
- Map `DataIntegrityViolationException` to `409`, `EntityNotFoundException`/`NoSuchElementException` to `404`, and validation errors to `400`/`422` with field details.

## Persistence

- `@Transactional` goes on **service** methods, never on controllers or repositories. Use `readOnly = true` for reads. Remember that self-invocation bypasses the proxy.
- Avoid N+1: `@EntityGraph`, `JOIN FETCH`, or DTO projections. Default to `FetchType.LAZY`, and keep `spring.jpa.open-in-view=false`.
- Use `@Version` optimistic locking for concurrent edits, and `@Lock(PESSIMISTIC_WRITE)` only for real check-then-act.
- Queries: derived queries, `@Query` with named parameters, or jOOQ. **Never concatenate** JPQL or SQL with input.
- Migrations: Flyway or Liquibase only (never `ddl-auto=update` outside local). Make them backward compatible and never edit applied ones.

## Observability

- SLF4J with structured logging (MDC request ID). No PII or secrets in logs.
- Use Actuator and Micrometer per the project. Don't expose sensitive actuator endpoints publicly.

## Testing

- **Unit:** JUnit 5 with MockK (Kotlin) or Mockito (Java). Test services without a Spring context.
- **Slices:** `@WebMvcTest` with `MockMvc` for controllers (validation 400/422, 401, 403, 404, 409), and `@DataJpaTest` with Testcontainers for repositories.
- Use `@SpringBootTest` sparingly and keep the context small.
- Run single tests only: `./gradlew test --tests 'com.acme.orders.OrderServiceTest'` or `mvn -Dtest=OrderServiceTest test`, per `project.apps[].test.command`. Never the full build.
