# Infrastructure and CI in the diff

Goal: containers, clusters, cloud resources and pipelines touched by the change follow least
privilege and do not leak secrets or run untrusted code with privileges. Review only infra files in
scope. Team rules: flag root containers unless explicitly confirmed, IAM `Action: "*"` or
`Resource: "*"`, and plain K8s Secrets for sensitive values.

## Dockerfile

- [ ] Runs as non-root: a `USER <non-root>` after installs (distroless `:nonroot`, `node` user in official Node images). No `USER root` at the end. Root without explicit confirmation: Medium.
- [ ] No secrets in `ARG`, `ENV`, `COPY .env`, `RUN echo $TOKEN > …`, or `--build-arg` values; use BuildKit secrets (`RUN --mount=type=secret,id=npm`). Secrets in layers are recoverable from the image: High.
- [ ] `.dockerignore` excludes `.env*`, `.git`, keys, `node_modules`.
- [ ] Base image pinned (tag + ideally `@sha256:` digest); not `latest`; maintained, minimal (slim/alpine/distroless).
- [ ] `ADD <remote URL>` or `curl | sh` without checksum verification: Medium.
- [ ] Multi-stage: build tools and source not in the runtime stage.
- [ ] `HEALTHCHECK` and no unnecessary `EXPOSE` (Info).

## docker-compose

- [ ] Databases/caches/admin UIs not bound to all interfaces on shared hosts (`"5432:5432"` binds `0.0.0.0`; prefer `"127.0.0.1:5432:5432"`) when the file is used beyond a laptop.
- [ ] No `privileged: true`, no `/var/run/docker.sock` mount, no `network_mode: host`, no `cap_add: [SYS_ADMIN]` without reason.
- [ ] Credentials via `env_file` not committed, or clearly dev-only values.

## Kubernetes / Helm

- [ ] Pod `securityContext`: `runAsNonRoot: true`, `allowPrivilegeEscalation: false`, `readOnlyRootFilesystem: true` where possible, `capabilities: { drop: ["ALL"] }`, `seccompProfile: RuntimeDefault`.
- [ ] No `privileged: true`, `hostNetwork`, `hostPID`, `hostIPC`, `hostPath` mounts (especially `/`, `/var/run/docker.sock`).
- [ ] Sensitive values not in plain `kind: Secret` manifests (base64 is not encryption) or in `ConfigMap`/env literals; use External Secrets Operator, Vault, Sealed Secrets or SOPS per the team rule.
- [ ] RBAC: no `verbs: ["*"]`, `resources: ["*"]`, `cluster-admin` bindings for app service accounts; `automountServiceAccountToken: false` when the pod does not call the API.
- [ ] Resource requests/limits set (DoS of neighbours: Low).
- [ ] Ingress: TLS configured; admin paths not exposed; NetworkPolicy restricts DB/cache access.
- [ ] Images pinned by digest or immutable tag; `imagePullPolicy` sane.

## Terraform / cloud IaC

- [ ] IAM: no `"Action": "*"`, `"Resource": "*"`, `"Principal": "*"`, `iam:PassRole` on `*`, wildcard `s3:*` on all buckets. Scope to specific ARNs and actions.
- [ ] Storage: no public buckets (`acl = "public-read"`, `block_public_acls = false`, public `google_storage_bucket_iam_member` with `allUsers`), encryption at rest on, versioning for critical data.
- [ ] Network: no `0.0.0.0/0` / `::/0` ingress on SSH (22), RDP (3389), DB ports (5432, 3306, 27017, 6379, 9200); DBs not `publicly_accessible = true`.
- [ ] No hard-coded credentials in providers, variables defaults, or `*.tfvars` committed; sensitive outputs marked `sensitive = true`.
- [ ] State backend encrypted and access-controlled (state files contain secrets).
- [ ] Logging/audit (CloudTrail, flow logs) not disabled by the change.
- [ ] OIDC trust for CI (AWS `token.actions.githubusercontent.com`): `sub` condition pinned to `repo:<org>/<repo>:ref:refs/heads/<branch>` or environment, never `repo:<org>/*` or missing.

## GitHub Actions

```bash
grep -nE "pull_request_target|workflow_run|\\$\\{\\{ *github\\.(event|head_ref)" .github/workflows/*.y*ml
grep -nE "uses: +[^ ]+@" .github/workflows/*.y*ml | grep -vE "@[0-9a-f]{40}"
```

- [ ] `pull_request_target` (and `workflow_run` triggered by PRs) runs with secrets and a write token in the base repo context. Checking out and executing PR code there (`actions/checkout` with `ref: ${{ github.event.pull_request.head.sha }}` / `head.ref`, then `npm install`, build, tests, scripts) is **Critical** (pwn request). Safe: use `pull_request`, or never execute PR code in that job.
- [ ] Untrusted expressions interpolated into `run:` (script injection): `github.event.issue.title`, `.issue.body`, `.pull_request.title`, `.pull_request.body`, `.pull_request.head.ref`, `github.head_ref`, `.comment.body`, `.review.body`, `.review_comment.body`, `.pages.*.page_name`, `.commits.*.message`, `.head_commit.message`, `.head_commit.author.email`/`.name`, `.discussion.title`/`.body`, `.workflow_run.head_branch`. Fix: pass via `env:` and reference `"$VAR"` quoted. Also applies to `actions/github-script` `script:` bodies.
- [ ] Third-party actions pinned to a full 40-char commit SHA (tags are mutable; tj-actions/changed-files 2025 compromise). First-party `actions/*` on major tags is acceptable per org policy (Low).
- [ ] `permissions:` declared at workflow or job level with least privilege (`contents: read` default); no `write-all`. Missing block → default token may be read/write depending on repo settings: Low/Medium.
- [ ] Secrets not echoed, not passed to untrusted actions, not exposed to forks; `ACTIONS_ALLOW_UNSECURE_COMMANDS` not set.
- [ ] Self-hosted runners not used for public-repo PR workflows.
- [ ] Artifacts/caches from untrusted runs not consumed by privileged workflows without validation (cache/artifact poisoning).
- [ ] Deploy jobs gated by environments with required reviewers/branch protection where the org uses them.
- [ ] Other CI (GitLab CI, CircleCI, Bitbucket): the same principles: protected variables only on protected branches, no MR code with deploy credentials, pinned images.

## Severity guide

Pwn request (`pull_request_target` + PR code execution): **Critical**. Script injection from
issue/PR text with secrets in scope: **High/Critical**. IAM `*` on production roles: **High**.
Public bucket with private data: **Critical**. Secret baked into an image: **High**. Root container,
unpinned third-party action, missing `permissions:`: **Medium/Low**.
