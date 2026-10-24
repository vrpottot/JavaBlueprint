# Deployment

Topology: browser → Vercel static frontend + `/api` server function → HTTPS nginx on the VPS → Fastify on `127.0.0.1:3001` → isolated Docker Java jobs.

Backend address: `https://javascope-api.193-233-246-241.sslip.io`. This temporary DNS name resolves to the provided VPS. Replace it with an owned domain when available. nginx terminates TLS; certbot renews the certificate automatically. SSH credentials and API secrets are not in this repository.

## Vercel

Import `vrpottot/JavaBlueprint`, production branch `main`, **Root Directory `frontend`**, framework Vite. `frontend/vercel.json` defines the build and API function duration. Set these server-side variables for Production (and Preview if previews should use the VPS):

| Name | Value |
| --- | --- |
| `BACKEND_URL` | `https://javascope-api.193-233-246-241.sslip.io` |
| `BACKEND_API_KEY` | Same secret as `/etc/javascope/backend.env` on VPS |

Leave `VITE_API_URL` unset. The browser calls its own HTTPS `/api`, and Vercel's function adds the backend key. Do not use a `VITE_` prefix for secrets; those are bundled into browser JavaScript. Backend processing routes reject calls without the gateway key. `/api/health` stays public.

Connect Vercel's Git integration to this repository to build/deploy after pushes to `main`. The gateway caps request/response bodies at 4 MiB; very large graphs must be split into smaller projects. Long Java jobs are bounded separately by the backend runner; the gateway's maximum is 240 seconds.

## VPS layout

- `/opt/javascope/releases/<commit>/`: independently installed and tested releases.
- `/opt/javascope/current`: atomic symlink to the active release.
- `/opt/javascope/repository.git`: shallow Git cache used by the updater.
- `/etc/javascope/backend.env`: production configuration and gateway key, mode 600.
- `/etc/javascope/release.env`: current commit and content-tagged runner image.
- `/etc/javascope/deploy.env`: Git repository, branch and read-only SSH key path.
- `/var/lib/javascope/tmp`: temporary source staging; API runs as user `javascope`.

Host prerequisites: Node 22.12+, JDK 21, Docker with enforced cgroups, nginx, certbot and Git. Ubuntu packages can be installed with `apt-get install --no-install-recommends nodejs npm openjdk-21-jdk-headless docker.io nginx certbot python3-certbot-nginx`. Keep ports 80/443 accessible and port 3001 bound to loopback. Install the supplied systemd units in `/etc/systemd/system/` and run `systemctl daemon-reload`.

Production limits for the allocated 2-core/4-GB VPS: two parser jobs, one verification job, 25 projects, 384 MiB Node heap and a 1400 MiB systemd memory ceiling for the API and parser children. Each untrusted Java container additionally has a 256 MiB memory ceiling, one CPU and a PID limit. nginx limits request bursts and concurrent connections. Runtime code and configuration are mounted read-only for the API process; only `/var/lib/javascope` is writable.

The API user belongs to the Docker group to launch trusted runner configurations. Docker access is privileged: do not expose the Docker socket to the internet or mount it into submitted Java containers.

## Automatic updates and short checks

Register `/root/.ssh/javascope_github.pub` as a **read-only repository Deploy key** in GitHub. The personal developer private key is never copied to the VPS. `/etc/javascope/deploy.env` contains:

```bash
GIT_REPOSITORY=git@github.com:vrpottot/JavaBlueprint.git
GIT_BRANCH=main
GIT_SSH_KEY=/root/.ssh/javascope_github
```

Then enable `systemctl enable --now javascope-update.timer`. The timer checks Git roughly once a minute; unchanged commits do not trigger builds. Updates run under a deployment lock, so builds cannot overlap.

Each changed commit performs:

1. `npm ci`, Java engine setup, TypeScript checks, `npm run test:ci`, build.
2. Build a content-tagged runner image **only if its Dockerfile/JUnit content changed**.
3. Start the candidate on port 3002. Run one small real API → AST edit → Big O → javac → JUnit → expected-output smoke scenario.
4. Switch the current symlink and restart production only after those checks pass.
5. Restore the previous release/image if the production health check fails. Keep five releases, including the active release and its predecessor.

Failures before switching leave production untouched. Restarts clear in-memory projects, so clients must reimport projects after a successful deployment. Tests are deliberately bounded: the CI suite has 16 focused test groups, with complexity examples batched in one JVM call; the deployment smoke compiles one tiny project. Browser tests and the full timeout/isolation suite are manual checks, not repeated every minute.

GitHub Actions also runs short backend checks and frontend build/lint, with a five-minute job limit and cancellation of superseded runs. VPS release checks are independent and remain mandatory even if Actions is unavailable. Builds typically take seconds to a few minutes on the first install; the updater times out after ten minutes rather than waiting indefinitely.

## Operations

```bash
systemctl status javascope
systemctl list-timers javascope-update.timer
journalctl -u javascope -n 50
journalctl -u javascope-update -n 80
curl -fsS https://javascope-api.193-233-246-241.sslip.io/api/health
systemctl start javascope-update.service
certbot certificates
```

`/api/health` reports the active Git revision. To perform a full check against production from the VPS without printing the secret:

```bash
set -a
source /etc/javascope/backend.env
set +a
API_URL=http://127.0.0.1:3001/api node /opt/javascope/current/backend/scripts/smoke.mjs
```

An initial release can be uploaded as a Git archive from an authenticated development machine, then installed with `bash /opt/javascope/releases/<commit>/deploy/release.sh /opt/javascope/releases/<commit> <commit>`. This does not remove the read-only Git key requirement for future automatic updates.
