# Deployment

Topology: browser → HTTPS nginx on the VPS → static Vite frontend and same-origin `/api` proxy → Fastify on `127.0.0.1:3001` → isolated Docker Java jobs.

Frontend: **https://javascope.193-233-246-241.sslip.io**. Backend administration/health address: `https://javascope-api.193-233-246-241.sslip.io`. This temporary DNS name resolves to the provided VPS. Replace it with an owned domain when available. nginx terminates TLS; certbot renews the certificate automatically. SSH credentials and API secrets are not in this repository.

## Frontend on the VPS

`deploy/nginx-frontend.conf` serves `/opt/javascope/current/frontend/dist` and proxies `/api/` directly to the local backend. It adds `X-Backend-Key` from `/etc/nginx/snippets/javascope-gateway.conf`; the browser never receives the secret. The snippet is generated locally from `/etc/javascope/backend.env` and has mode 600. Never run `nginx -T` in shared logs because that would print the secret include.

Install the frontend configuration as `/etc/nginx/sites-available/javascope-web`, enable the matching symlink, validate with `nginx -t`, and reload nginx. Issue the certificate with `certbot --nginx -d javascope.193-233-246-241.sslip.io --redirect`. Certbot's renewal timer maintains both frontend and backend certificates. The API rate-limit zones must already be loaded from `deploy/nginx.conf`.

The frontend is built with `VITE_API_URL=/api`. Hashed assets use immutable caching and gzip; HTML and `/version.txt` are revalidated. Missing assets return 404, while application routes fall back to `index.html`. Only the built `dist` directory is public. No Vercel account is needed for this deployment.

## Optional Vercel alternative

Import `vrpottot/JavaBlueprint`, production branch `main`, **Root Directory `frontend`**, framework Vite. `frontend/vercel.json` defines the build and API function duration. Set these server-side variables for Production (and Preview if previews should use the VPS):

| Name | Value |
| --- | --- |
| `BACKEND_URL` | `https://javascope-api.193-233-246-241.sslip.io` |
| `BACKEND_API_KEY` | Same secret as `/etc/javascope/backend.env` on VPS |

Leave `VITE_API_URL` unset. The browser calls its own HTTPS `/api`, and Vercel's function adds the backend key. Do not use a `VITE_` prefix for secrets; those are bundled into browser JavaScript. Backend processing routes reject calls without the gateway key. `/api/health` stays public.

Connect Vercel's Git integration to this repository to build/deploy after pushes to `main`. The gateway caps request/response bodies at 4 MiB; very large graphs must be split into smaller projects. Long Java jobs are bounded separately by the backend runner; the gateway's maximum is 240 seconds.

## AI gateway

AI chat uses a separate [OmniRoute](https://github.com/cheaper-inference/OmniRoute) container on the VPS. The backend connects to `http://127.0.0.1:20128/v1` with `AI_MODEL=ddgw/claude-haiku-4-5`. `AI_API_KEY` authenticates the backend to this gateway; upstream credentials depend on the selected provider. DuckDuckGo anonymous access worked in the verified deployment; provider quotas and availability still apply.

Set `AI_API_KEY`, `AI_BASE_URL` and `AI_MODEL` in `/etc/javascope/backend.env`, then run `bash deploy/install-ai-gateway.sh` as root on the VPS. The installer pins OmniRoute 3.8.52 by image digest, reuses the backend's gateway key, generates private dashboard/encryption secrets once, and stores them in `/etc/javascope/omniroute.env` with mode 600. It preserves these secrets on reruns. Restart `javascope` after changing its environment.

Only loopback port 20128 is published. The dashboard and AI key are not exposed through nginx or bundled into the frontend. The container has a one-core quota, a 1 GiB memory limit, no extra capabilities and `restart: unless-stopped`. The `javascope-ai-data` volume keeps its database across container replacement. Application releases do not replace its configuration or volume. Rerunning the installer with unchanged configuration leaves the existing container running. Large projects use bounded prompt context; naming methods in a question prioritizes their code and source-linked AST nodes. The model is told when other code is omitted.

Check it with `docker ps --filter name=javascope-ai` and `docker stats --no-stream javascope-ai`. Use the website's **Чат с ИИ** panel to exercise the full frontend → backend → gateway → model path. Browser verification confirmed a real streamed Russian response and a structured analysis update in **Сводка**. The two supplied Java stress-test files separately compiled and passed all 12 JUnit tests.

## VPS layout

- `/opt/javascope/releases/<commit>/`: independently installed and tested releases.
- `/opt/javascope/current`: atomic symlink to the active frontend/backend release; nginx follows it for static files.
- `/opt/javascope/repository.git`: shallow Git cache used by the updater.
- `/etc/javascope/backend.env`: production configuration and gateway key, mode 600.
- `/etc/javascope/release.env`: current commit and content-tagged runner image.
- `/etc/javascope/deploy.env`: Git repository, branch and read-only SSH key path.
- `/var/lib/javascope/tmp`: temporary source staging; API runs as user `javascope`.

Host prerequisites: Node 22.12+, JDK 21, Docker with enforced cgroups, nginx, certbot and Git. Ubuntu packages can be installed with `apt-get install --no-install-recommends nodejs npm openjdk-21-jdk-headless docker.io nginx certbot python3-certbot-nginx`. Keep ports 80/443 accessible and port 3001 bound to loopback. Install the supplied systemd units in `/etc/systemd/system/` and run `systemctl daemon-reload`.

Production limits for the allocated 2-core/4-GB VPS: two parser jobs, one verification job, 25 projects, 384 MiB Node heap and a 1400 MiB systemd memory ceiling for the API and parser children. Each untrusted Java container additionally has a 256 MiB memory ceiling, one CPU and a PID limit. nginx limits request bursts and concurrent connections. Runtime code and configuration are mounted read-only for the API process; only `/var/lib/javascope` is writable.

The API user belongs to the Docker group to launch trusted runner configurations. Docker access is privileged: do not expose the Docker socket to the internet or mount it into submitted Java containers.

## Automatic updates and short checks

The primary path is GitHub Actions, with no VPS password, SSH private key or long-lived deployment token stored in GitHub. After short checks pass on a push to `main`, the workflow requests a short-lived GitHub OIDC identity and uploads a Git archive to `/_deploy` over HTTPS. The runtime bundle contains `backend/`, `frontend/` and `deploy/`; documentation, audit evidence and presentation images remain available in the GitHub repository. CI checks the bundle against the 8 MiB upload limit before sending it.

The receiver listens only on `127.0.0.1:3003`, behind nginx. It verifies GitHub's RS256 signature against its fixed JWKS endpoint, issuer, audience, expiry, maximum token age, repository owner/name, `main` ref, push event, exact workflow path and commit SHA. It rejects stale workflow run numbers and replayed identities. Branch/PR checks cannot deploy. Uploads are limited to 8 MiB; Python's data extraction filter and expanded-size/member limits protect source extraction. A deployment lock serializes releases.

Install `javascope-deploy-receiver.service`, create `/opt/javascope/incoming` with mode 700, and enable the receiver. It uses the active release's compiled `backend/dist/deploy-receiver.js`; successful releases restart it. GitHub must have Actions enabled; the workflow grants only `contents: read` and `id-token: write`.

An optional pull-based fallback is included in `javascope-update.timer`. It checks Git roughly once a minute and needs a read-only repository Deploy key at `/root/.ssh/javascope_github`. This fallback is **disabled** when the key has not been registered; it is not required for the primary Actions deployment path. `/etc/javascope/deploy.env` selects the repository and `main` branch. Personal developer private keys are never copied to the VPS.

Each changed commit performs:

1. Backend dependencies, Java engine setup, TypeScript checks, `npm run test:ci` and build; then frontend dependencies, lint, `npm --prefix ../backend run test:frontend` and production build.
2. Build a content-tagged runner image **only if its Dockerfile/JUnit content changed**.
3. Start the candidate on port 3002. Run one small real API → AST edit → Big O → javac → JUnit → expected-output smoke scenario.
4. Switch the shared current symlink and restart production only after those checks pass. Check public frontend HTML, its commit marker and the same-origin API before accepting the release.
5. Restore the previous frontend/backend release and runner image if a production health check fails. Keep five releases, including the active release and its predecessor.

Failures before switching leave production untouched. Restarts clear in-memory projects, so clients must reimport projects after a successful deployment. Tests are deliberately bounded: 27 backend groups plus two frontend store/diagnostics groups, including method editing, bounded AI context, graph layout and complexity counterexamples. Complexity examples are batched in one JVM call; the deployment smoke compiles one tiny project. CI never calls a real AI provider. Browser tests and the full timeout/isolation suite are manual checks, not repeated every minute.

GitHub Actions runs short backend checks, frontend build/lint and a gateway smoke check, with a five-minute job limit and cancellation of superseded runs. VPS release checks are independent and remain mandatory even if Actions is unavailable. Builds typically take seconds to a few minutes on the first install; the updater times out after ten minutes rather than waiting indefinitely.

## Operations

```bash
systemctl status javascope
systemctl status javascope-deploy-receiver
systemctl list-timers javascope-update.timer
journalctl -u javascope -n 50
journalctl -u javascope-deploy-receiver -n 30
journalctl -u 'javascope-release-*' -n 80
curl -fsS https://javascope-api.193-233-246-241.sslip.io/api/health
systemctl start javascope-update.service
certbot certificates
```

`/api/health` reports the active backend Git revision; the frontend exposes the same revision at `/version.txt`. GitHub Actions waits until both match the pushed commit. To perform a full check against production from the VPS without printing the secret:

```bash
set -a
source /etc/javascope/backend.env
set +a
API_URL=http://127.0.0.1:3001/api node /opt/javascope/current/backend/scripts/smoke.mjs
```

An initial release can be uploaded as a Git archive from an authenticated development machine, then installed with `bash /opt/javascope/releases/<commit>/deploy/release.sh /opt/javascope/releases/<commit> <commit>`. Future automatic updates use Actions/OIDC; a Git key is needed only for the optional polling fallback.

## Measured checks

On the allocated VPS, the first installation took 99 seconds including the initial runner image build; cached deployments took about 66–67 seconds. The short backend tests took about 23–26 seconds on its two cores, and the live HTTPS/javac/JUnit smoke took about 8–11 seconds. On the development machine, 23 full tests passed in 55 seconds, while the 17-group CI suite took about six seconds. Gateway and browser checks also passed. The first GitHub push authenticated successfully to the VPS through OIDC without a repository deploy key.


To run the browser workflow against the live VPS instead of starting local servers:

```bash
E2E_BASE_URL=https://javascope.193-233-246-241.sslip.io CHROME_PATH=/path/to/chrome npm --prefix backend run test:browser
```

The browser test is a manual post-deployment check; it is not added to each automatic release.
