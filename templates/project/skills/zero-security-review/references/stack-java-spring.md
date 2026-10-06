# Stack: Java / Kotlin with Spring (Boot, MVC, WebFlux, Security, Data JPA)

## Locate the protection layer

```bash
grep -rnE "SecurityFilterChain|authorizeHttpRequests|authorizeRequests|requestMatchers|antMatchers|mvcMatchers|permitAll|csrf|cors|EnableMethodSecurity|EnableGlobalMethodSecurity|PreAuthorize|Secured|RolesAllowed|OncePerRequestFilter" --include=*.{java,kt} .
grep -rnE "management\.endpoints|include-stacktrace|include-message|h2\.console|spring\.jpa\.show-sql|server\.ssl" --include=*.{properties,yml,yaml} .
grep -rnE "createQuery\(.*\+|createNativeQuery\(.*\+|jdbcTemplate\.(query|update|execute)\(.*\+|parseExpression|ObjectInputStream|enableDefaultTyping|activateDefaultTyping|JsonTypeInfo|new Yaml\(|DocumentBuilderFactory|SAXParserFactory|XMLInputFactory|Runtime\.getRuntime|ProcessBuilder|new Random\(|th:utext|TrustManager|setHostnameVerifier" --include=*.{java,kt,html} <scope>
```

## Spring Security configuration

- [ ] `SecurityFilterChain` rules are ordered most-specific first; `anyRequest().authenticated()` (or `denyAll()`) last. `anyRequest().permitAll()` with per-path `authenticated()` is fail-open: any new path is public.
- [ ] Matcher semantics: Spring Security 6 `requestMatchers` uses MVC matching for Spring MVC apps; older `antMatchers("/admin")` did not match `/admin/` or `/admin.json` in some versions. Verify new endpoints fall under the intended matcher, including trailing slash and suffix variants.
- [ ] Multiple filter chains: `securityMatcher` order (`@Order`) correct; an earlier broad chain may swallow requests.
- [ ] `csrf.disable()` only for stateless token auth; with session cookies it needs CSRF protection (`CookieCsrfTokenRepository` for SPAs).
- [ ] Session management: `sessionFixation().migrateSession()` (default), `SessionCreationPolicy.STATELESS` for JWT APIs.
- [ ] Custom auth filters (`OncePerRequestFilter`): exceptions do not fall through to an authenticated state; `shouldNotFilter` exclusions are narrow; the `SecurityContext` is cleared between requests.
- [ ] CORS: `CorsConfiguration` with `allowCredentials(true)` must not use `allowedOriginPatterns("*")`; `@CrossOrigin` on controllers reviewed.

## Method security and object authorization

- [ ] `@PreAuthorize`/`@Secured`/`@RolesAllowed` are ignored unless method security is enabled (`@EnableMethodSecurity`; legacy `@EnableGlobalMethodSecurity(prePostEnabled = true)`). Verify before trusting annotations.
- [ ] Annotations on `private` methods or self-invocations (calling `this.method()`) are bypassed by the proxy.
- [ ] Role checks: `hasRole('ADMIN')` expects authority `ROLE_ADMIN`; mismatches silently deny or grant.
- [ ] Ownership: `@PreAuthorize("@authz.canRead(#id, authentication)")` or service-level checks; `findById(id)` from a path variable with no owner/tenant filter is IDOR. Spring Data: `findByIdAndOwnerId(id, ownerId)`.
- [ ] `@PostFilter`/`@PostAuthorize` on large result sets: inefficient and leaks counts; filter in the query.

## Binding, validation, mass assignment

- [ ] `@Valid`/`@Validated` on `@RequestBody`/`@ModelAttribute` parameters; without it, Bean Validation constraints on the DTO are not evaluated. Nested objects need `@Valid` on the field.
- [ ] Bind to DTOs/records, not JPA `@Entity` classes (mass assignment of `role`, `owner`, `id`; also over-posting relations). `@ModelAttribute` binds any request param to any setter: use DTOs or `@InitBinder` `setAllowedFields`.
- [ ] Jackson: `FAIL_ON_UNKNOWN_PROPERTIES` true where strict input is required; `@JsonIgnoreProperties(ignoreUnknown = true)` is acceptable only on DTOs without sensitive fields.
- [ ] Kotlin: non-null DTO fields with defaults can hide missing input; validate explicitly.

## Injection

- [ ] JPQL/HQL: `createQuery("… where name = '" + name + "'")` → use `:name` parameters. Native: `createNativeQuery(… + x)` same. Spring Data `@Query` with `:param`/`?1` is safe; SpEL `:#{…}` in `@Query` is safe when it binds a value.
- [ ] `JdbcTemplate`/`NamedParameterJdbcTemplate`: `?` / `:name` args; never concatenation. `ORDER BY` from `Sort.by(userInput)` in derived queries is validated by Spring Data against properties, but `JpaSort.unsafe()` and string-built native `ORDER BY` are not.
- [ ] Criteria API / QueryDSL / jOOQ are safe unless `Expressions.stringTemplate`/`DSL.field(String)` is fed user input.
- [ ] SpEL: `new SpelExpressionParser().parseExpression(user)` → RCE (Critical). Use `SimpleEvaluationContext` if evaluation of user expressions is a feature.
- [ ] Commands: `Runtime.exec(String)` tokenizes on spaces (still dangerous); use `ProcessBuilder(List)` with a fixed binary.
- [ ] Paths: `new File(base, name)` / `Paths.get(base, name)` → `normalize()` then `startsWith(base)`; `ResourceLoader.getResource(user)` (`file:`/`classpath:`/`url:` prefixes = file read/SSRF).
- [ ] Thymeleaf: `th:utext` with user data (XSS); controller returning a view name containing user input (`return "user/" + lang;`) enables expression preprocessing (`__${…}__`) → SSTI/RCE. Same for `redirect:`/`forward:` with user input (open redirect).
- [ ] LDAP (`LdapTemplate` filters built by concatenation), XPath.

## Deserialization and XML

- [ ] `ObjectInputStream.readObject` on untrusted data: Critical (gadget chains). Also Spring `HttpInvoker`, RMI, JMS `ObjectMessage`.
- [ ] Jackson polymorphic typing: `activateDefaultTyping`/`enableDefaultTyping`, `@JsonTypeInfo(use = Id.CLASS / MINIMAL_CLASS)` on fields fed by users. Use `Id.NAME` with explicit subtypes or a `PolymorphicTypeValidator`.
- [ ] SnakeYAML < 2.0 `new Yaml().load(user)`: use `SafeConstructor`/upgrade. XStream without allowlist.
- [ ] XML parsers: set `disallow-doctype-decl` true (or disable external general/parameter entities and `XMLConstants.ACCESS_EXTERNAL_DTD = ""`) on `DocumentBuilderFactory`, `SAXParserFactory`, `XMLInputFactory`, `TransformerFactory`, `SchemaFactory`; JAXB `Unmarshaller` from an unsafe source.

## Configuration and exposure

- [ ] Actuator: `management.endpoints.web.exposure.include` limited (`health,info`); `env`, `heapdump`, `threaddump`, `loggers`, `configprops`, `mappings`, `jolokia` never public; actuator secured by the filter chain or a separate port.
- [ ] `server.error.include-stacktrace=never`, `include-message=never` (or `on_param` only in dev); H2 console off outside local; `spring.jpa.show-sql` off in prod.
- [ ] Secrets via env/Vault/`spring.config.import=vault://`, not in `application.yml` committed; `@Value("${jwt.secret:default}")` defaults are fallback secrets.
- [ ] Return DTOs, not entities (`ResponseEntity<User>` serializes everything incl. lazy relations); `@JsonIgnore` on secret fields as defense in depth.

## Crypto and auth

- [ ] Passwords: `BCryptPasswordEncoder`/`Argon2PasswordEncoder`/`DelegatingPasswordEncoder`; never `NoOpPasswordEncoder`, `MessageDigest` MD5/SHA for passwords.
- [ ] `SecureRandom` for tokens; `MessageDigest.isEqual` for secret compares.
- [ ] JWT: jjwt `parseSignedClaims`/`parseClaimsJws` (not `parse`/`parseClaimsJwt`, which accept unsigned tokens); Nimbus `JWTProcessor` with expected `JWSAlgorithm`; Spring Resource Server with `issuer-uri`/`jwk-set-uri` and audience validator.
- [ ] TLS: no trust-all `X509TrustManager`, no `HostnameVerifier` returning true, no `SSLContext` with null trust managers in production code.
- [ ] Cipher: `Cipher.getInstance("AES")` defaults to ECB: use `AES/GCM/NoPadding` with a unique IV.

## Concurrency and data

- [ ] `@Transactional` on methods implementing check-then-act; correct propagation; self-invocation bypasses `@Transactional` (proxy). `@Version` for optimistic locking, `@Lock(PESSIMISTIC_WRITE)` where required (see `business-logic.md`).
- [ ] `RestTemplate`/`WebClient` to user URLs: SSRF controls, timeouts, redirect policy.

## Logging

- [ ] log4j-core ≥ 2.17.1 if present; no logging of passwords/tokens/`Authorization`; user input in log messages through parameters (`log.info("x={}", x)`).

## Tooling

- [ ] OSV-Scanner or the project's configured dependency-check task when `pom.xml`/`build.gradle*` changed (see `dependencies.md`); never trigger a full build just to scan.
