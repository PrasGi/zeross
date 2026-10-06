# Injection and SSRF

Goal: untrusted data never becomes code, query structure, a command, a path outside its root,
a template, or a request to an internal host. ASVS V5.2–V5.3, V12.3, V12.6. For DB specifics also
load `db-sql.md` / `db-mongo.md`.

Rule of thumb: injection is about **structure vs data**. Data must travel in a channel that cannot
change structure (bound parameters, argv arrays, typed filters). Escaping is a fallback;
allowlists are the only safe option for identifiers (column names, sort keys, commands).

## SQL (summary, details in `db-sql.md`)

Smells: string building into a query API.

```text
`SELECT … ${x}`   "… " + x   f"… {x}"   "…%s" % x   fmt.Sprintf("… %s", x)   "… $x" (PHP)
$queryRawUnsafe  $executeRawUnsafe  Prisma.raw  sequelize.query  knex.raw  whereRaw  orderByRaw
sql.raw (drizzle)  createQueryBuilder().where("id = " + id)  .orderBy(userInput)
cursor.execute(f"…")  text(f"…")  .extra()  RawSQL  raw()  DB::raw  DB::select("… $x")
db.Query(fmt.Sprintf(…))  gorm.Where(fmt.Sprintf(…))  gorm.Order(userInput)
createQuery("… " + x)  createNativeQuery(… + x)  jdbcTemplate.query("… " + x)
```

- [ ] Values bound as parameters; identifiers (`ORDER BY`, column, table, direction) from an allowlist map.
- [ ] Second-order: a value stored earlier (username, filename) and later concatenated into a query.

## NoSQL operator injection (details in `db-mongo.md`)

- [ ] A JSON body or `qs`-parsed query value used directly in a filter: `{"email": "a@b.c", "password": {"$ne": null}}` logs in as anyone. Same for `$gt`, `$regex`, `$in`, `$exists`, `$expr`.
- [ ] Server-side JS: `$where`, `$function`, `$accumulator`, `mapReduce` with any user input → code execution in the DB.
- [ ] Update docs built from the body: `{$set: req.body}`, or the body itself containing `$set`/`$rename`/`$unset`.
- Safe: validate scalar types first (`typeof x === 'string'`), wrap with `$eq`, Mongoose `sanitizeFilter: true`, `express-mongo-sanitize`, decode into typed structs (Go/Java/Python models).

## OS command injection

```text
child_process.exec(  execSync(  spawn(…, { shell: true })  shelljs
os.system(  subprocess.*(…, shell=True)  os.popen(  commands.getoutput(
exec.Command("sh", "-c", …)  exec.Command("bash", "-c", …)
exec(  system(  passthru(  shell_exec(  proc_open(  popen(  backticks (PHP)
Runtime.getRuntime().exec(String)  ProcessBuilder("sh", "-c", …)
```

- [ ] Use argv arrays without a shell (`execFile`, `spawn(cmd, args)`, `subprocess.run([...])`, `exec.Command(bin, args...)`, `ProcessBuilder(list)`).
- [ ] Argument injection even without a shell: user value starting with `-` becomes a flag (`git` `--upload-pack=`, `curl -o`, `tar --checkpoint-action`, `find -exec`). Put `--` before user args and validate the format.
- [ ] Binary name never from user input.

## Code evaluation

`eval(`, `new Function(`, `vm.runIn*` (Node `vm` is **not** a sandbox), `setTimeout("string")`,
Python `eval`/`exec`/`compile`, PHP `eval`/`assert(string)`/`preg_replace /e`/`create_function`,
Java `ScriptEngine.eval`, SpEL `parseExpression(user)`, OGNL/MVEL. Any user input reaching these: Critical.

## Path traversal and file inclusion

Smells: user input joined into a filesystem path.

```text
path.join(base, userInput)  res.sendFile(userInput)  fs.readFile(`${dir}/${name}`)
os.path.join(base, name)    open(base + name)   send_file(name)
filepath.Join(base, name)   http.ServeFile(w, r, name)
include $var  require $var  file_get_contents($name)  Storage::get($name)
new File(base, name)  Paths.get(base, name)
```

- [ ] Resolve then contain: `const p = path.resolve(base, name); if (!p.startsWith(path.resolve(base) + path.sep)) reject`. Python: `Path(base, name).resolve().is_relative_to(Path(base).resolve())`. Go ≥ 1.24: `os.Root`; Go ≥ 1.20: `filepath.IsLocal(name)`. Java: `base.resolve(name).normalize().startsWith(base)`.
- [ ] `os.path.join(base, "/etc/passwd")` and `path.join` with absolute segments: Python discards `base`; Node `path.resolve` does too.
- [ ] Express `res.sendFile(name, { root })` with `root` set; `dotfiles: 'deny'`.
- [ ] Prefer IDs → server-side lookup of the real path over user-supplied names.
- [ ] Archive extraction: zip slip (Python ≥ 3.12 `tarfile.extractall(filter='data')`; check every entry path).
- [ ] Symlinks inside upload/extract dirs.

## Server-side template injection (SSTI)

- [ ] User input used **as** a template, not passed **to** one: Jinja2 `Template(user)` / `render_template_string(user)`, Handlebars/Pug/EJS `compile(user)`, Twig `createTemplate`, Blade `Blade::render($user)`, Thymeleaf view names containing user input (`return "page/" + lang` → `__${...}__` preprocessing), Freemarker/Velocity with user templates, Go `template.New().Parse(user)`.
- [ ] Email/notification templates editable by tenants: sandboxed engine (Jinja2 `SandboxedEnvironment`, Liquid) and no access to internals.

## ReDoS

- [ ] User-supplied regex: `new RegExp(req.query.q)`, `re.compile(user)`, Mongo `$regex: user`. Escape (`escapeRegExp`, `re.escape`, `preg_quote`) or use RE2 (`re2` npm, Go's `regexp` is RE2 and safe).
- [ ] Catastrophic patterns applied to user input: nested quantifiers `(a+)+`, `(.*)*`, `(\w+\s?)*$`, overlapping alternations `(a|aa)+`. Validate length before matching.

## Prototype pollution (JavaScript)

- [ ] Deep merge / set-by-path with user keys: `lodash.merge`/`defaultsDeep`/`set`/`setWith` (old versions), `deepmerge`, custom recursive merge, `obj[key1][key2] = value` with user `key1`.
- [ ] Payloads: `{"__proto__": {"isAdmin": true}}`, `{"constructor": {"prototype": {...}}}`, `a[__proto__][x]=1` via `qs`.
- [ ] Safe: block `__proto__`, `constructor`, `prototype` keys; use `Object.create(null)` or `Map`; `structuredClone`; schema-validate first. Impact: authz bypass via polluted defaults, RCE via gadget (`child_process` `shell`/`env` options).

## Unsafe deserialization

- [ ] Python `pickle.loads`, `yaml.load` without `SafeLoader` (`yaml.safe_load` is fine), `jsonpickle`, `shelve`.
- [ ] Java `ObjectInputStream.readObject`, Jackson default typing / `@JsonTypeInfo(use = Id.CLASS)`, XStream, SnakeYAML < 2.0 `new Yaml().load`.
- [ ] PHP `unserialize($user)` (use `json_decode`, or `allowed_classes => false`), `phar://` wrappers on file functions.
- [ ] Node `node-serialize`, `serialize-javascript` output evaluated, `funcster`.
- [ ] Signed blobs (cookies, view state) are only as safe as the key: a leaked Laravel `APP_KEY` or Rails/Django secret makes deserialization reachable.

## XXE and XML

- [ ] Java `DocumentBuilderFactory`/`SAXParserFactory`/`XMLInputFactory` without `disallow-doctype-decl` / external entities off.
- [ ] Python `xml.etree`/`lxml` on untrusted XML: use `defusedxml`; lxml `resolve_entities=False`.
- [ ] PHP `libxml` with `LIBXML_NOENT`. SVG/DOCX/XLSX uploads are XML too.

## Header, log and other injections

- [ ] CRLF in headers: user input in `setHeader`, `Location`, `Content-Disposition` filename (encode with RFC 5987).
- [ ] Log injection: newlines in user input forging log lines (encode or structured logging).
- [ ] LDAP filters, XPath, email headers (`To`/`Subject` with `\r\n`), CSV formula injection (see `data-exposure.md`).

## SSRF

Sinks: any server-side fetch of a URL or host influenced by the user: `fetch`, `axios`, `got`,
`http.Get`, `requests`, `httpx`, `urllib`, `file_get_contents`, Guzzle/`Http::`, `RestTemplate`,
`WebClient`, image/link-preview fetchers, PDF/HTML renderers (Puppeteer, wkhtmltopdf), webhook
"test delivery" features, import-from-URL, OAuth/OIDC discovery URLs, XML external entities,
`next/image` remote patterns.

- [ ] Prefer an allowlist of exact hosts. If arbitrary URLs are a feature:
  - Scheme allowlist: `http`, `https` only (no `file:`, `gopher:`, `ftp:`, `dict:`, `data:`).
  - Resolve DNS server-side and block private, loopback, link-local and metadata ranges for **every** resolved IP: `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16` (incl. `169.254.169.254`), `100.64.0.0/10`, `0.0.0.0/8`, `::1`, `fc00::/7`, `fe80::/10`, IPv4-mapped IPv6 `::ffff:0:0/96`; hostnames `metadata.google.internal`, `metadata`, `localhost`.
  - Connect to the IP you validated (pin it) to defeat DNS rebinding: custom `lookup`/agent in Node (`ssrf-req-filter`, `request-filtering-agent`), `net.Dialer.Control` in Go, a validating transport adapter in Python.
  - Redirects: disable, or re-validate every hop.
  - Beware parser differentials: `http://127.1`, `http://0x7f000001`, `http://[::]`, `http://evil.com@127.0.0.1`, `http://127.0.0.1#@evil.com`, backslashes. Validate on the parsed URL object, not with regex on the string.
- [ ] Response not reflected to the user in full (blind SSRF is still High if it reaches metadata or internal admin APIs).
- [ ] Timeouts and max response size on outbound calls.

## Severity guide

Reachable SQL/NoSQL injection, command injection, code eval, SSTI, unsafe deserialization:
**Critical** (High if admin-only). Path traversal reading arbitrary files: **High** (Critical if it
reaches secrets/source or allows write). SSRF reaching metadata/internal services: **High**
(Critical with cloud credential theft shown). ReDoS on a public endpoint: **Medium**. Prototype
pollution: **Medium**, **High/Critical** with a demonstrated gadget.
