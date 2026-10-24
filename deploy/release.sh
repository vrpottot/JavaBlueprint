#!/usr/bin/env bash
set -euo pipefail
release=$(realpath "$1")
revision=$2
[[ "$release" == /opt/javascope/releases/* && "$revision" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid release'; exit 1; }
started=$SECONDS
cd "$release/backend"
chown -R javascope:javascope "$release"
runuser -u javascope -- npm ci --no-audit --no-fund --loglevel=error
runuser -u javascope -- npm run setup
runuser -u javascope -- npm run typecheck
runuser -u javascope -- npm run test:ci
runuser -u javascope -- npm run build
runner_hash=$(cat runner/Dockerfile java-engine/lib/junit.jar | sha256sum | cut -c1-16)
runner_image=javablueprint-runner:$runner_hash
if ! docker image inspect "$runner_image" >/dev/null 2>&1; then
  docker build --quiet -t "$runner_image" -f runner/Dockerfile .
fi
# Test the candidate before replacing the live symlink or restarting production.
grep -v '^PORT=' /etc/javascope/backend.env > /etc/javascope/candidate.env
printf 'PORT=3002\n' >> /etc/javascope/candidate.env
printf 'RUNNER_IMAGE=%s\n' "$runner_image" >> /etc/javascope/candidate.env
chmod 600 /etc/javascope/candidate.env
systemctl reset-failed javascope-candidate.service >/dev/null 2>&1 || true
systemd-run --quiet --unit=javascope-candidate --property=User=javascope --property=Group=javascope \
  --property=SupplementaryGroups=docker --property=EnvironmentFile=/etc/javascope/candidate.env \
  --property=WorkingDirectory="$release/backend" --property=MemoryMax=1400M \
  --property=UMask=0077 --property=NoNewPrivileges=yes --property=PrivateDevices=yes \
  --property=ProtectSystem=strict --property=ProtectHome=yes --property=ReadWritePaths=/var/lib/javascope \
  --property=TasksMax=256 \
  /usr/bin/node --max-old-space-size=384 "$release/backend/dist/server.js"
trap 'systemctl stop javascope-candidate.service >/dev/null 2>&1 || true' EXIT
for attempt in {1..30}; do
  if curl -fsS http://127.0.0.1:3002/api/health >/dev/null 2>&1; then break; fi
  sleep 0.2
done
set -a
source /etc/javascope/backend.env
set +a
API_URL=http://127.0.0.1:3002/api node scripts/smoke.mjs
systemctl stop javascope-candidate.service
trap - EXIT
previous=$(readlink -f /opt/javascope/current || true)
ln -sfn "$release" /opt/javascope/current.next
mv -Tf /opt/javascope/current.next /opt/javascope/current
if [[ -f /etc/javascope/release.env ]]; then cp /etc/javascope/release.env /etc/javascope/previous-release.env; fi
printf 'GIT_SHA=%s\nRUNNER_IMAGE=%s\n' "$revision" "$runner_image" > /etc/javascope/release.env
systemctl restart javascope
healthy=false
for attempt in {1..30}; do
  if curl -fsS http://127.0.0.1:3001/api/health >/dev/null 2>&1; then healthy=true; break; fi
  sleep 0.2
done
if [[ "$healthy" != true ]]; then
  if [[ -n "$previous" && "$previous" != "$release" ]]; then
    ln -sfn "$previous" /opt/javascope/current
    if [[ -f /etc/javascope/previous-release.env ]]; then cp /etc/javascope/previous-release.env /etc/javascope/release.env; fi
    systemctl restart javascope
  fi
  echo 'Release failed health check; rolled back'; exit 1
fi
printf '%s\n' "$revision" > /var/lib/javascope/deployed-head
systemctl try-restart javascope-deploy-receiver.service >/dev/null 2>&1 || true
echo "Deployed $revision in $((SECONDS-started)) seconds"
# Keep five releases; never delete the active release or its predecessor.
find /opt/javascope/releases -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -nr | tail -n +6 | cut -d' ' -f2- | while IFS= read -r old; do
  if [[ "$old" != "$release" && "$old" != "$previous" ]]; then rm -rf -- "$old"; fi
done
