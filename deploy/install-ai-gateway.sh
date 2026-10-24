#!/usr/bin/env bash
set -euo pipefail
[[ "$EUID" == 0 ]] || { echo 'Run this installer as root'; exit 1; }
command -v docker >/dev/null

# OmniRoute 3.8.52. Update the digest deliberately after testing a new release.
image=diegosouzapw/omniroute@sha256:b08a12e876baa8a5ccadd1ebbe346fe7267dba3b1c9f4fd6bb02070fae41ab6c
name=javascope-ai
env_file=/etc/javascope/omniroute.env

python3 - <<'PY'
import os, pathlib, secrets, tempfile

def read_env(path):
    if not path.exists():
        return {}
    return dict(line.split('=', 1) for line in path.read_text().splitlines()
                if '=' in line and not line.lstrip().startswith('#'))

backend = read_env(pathlib.Path('/etc/javascope/backend.env'))
if not backend.get('AI_API_KEY'):
    raise SystemExit('Set AI_API_KEY in /etc/javascope/backend.env first')
path = pathlib.Path('/etc/javascope/omniroute.env')
settings = read_env(path)
for key, size in [('JWT_SECRET', 48), ('API_KEY_SECRET', 32), ('INITIAL_PASSWORD', 32)]:
    settings.setdefault(key, secrets.token_hex(size))
settings.update({
    'OMNIROUTE_API_KEY': backend['AI_API_KEY'],
    'REQUIRE_API_KEY': 'true',
    'DATA_DIR': '/app/data',
    'PORT': '20128',
    'HOSTNAME': '0.0.0.0',
    'NODE_OPTIONS': '--max-old-space-size=512',
    'NEXT_TELEMETRY_DISABLED': '1',
    'APP_LOG_TO_FILE': 'false',
    'ENABLE_REQUEST_LOGS': 'false',
})
if any(any(c in value for c in '\r\n\0') for value in settings.values()):
    raise SystemExit('Environment values must be single-line strings')
with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, delete=False) as output:
    output.write(''.join(key + '=' + value + '\n' for key, value in settings.items()))
    output.flush()
    os.fsync(output.fileno())
    temporary = output.name
os.chmod(temporary, 0o600)
os.replace(temporary, path)
PY

docker pull "$image"
docker volume create javascope-ai-data >/dev/null
config_hash=$(sha256sum "$env_file" | cut -d' ' -f1)
current_hash=$(docker inspect --format '{{index .Config.Labels "javascope.ai.config"}}' "$name" 2>/dev/null || true)
current_image=$(docker inspect --format '{{.Config.Image}}' "$name" 2>/dev/null || true)
if [[ "$current_hash" == "$config_hash" && "$current_image" == "$image" ]]; then
  docker start "$name" >/dev/null
else
  if docker container inspect "$name" >/dev/null 2>&1; then
    docker stop --time 40 "$name" >/dev/null
    docker rm "$name" >/dev/null
  fi
  docker run --detach --name "$name" --restart unless-stopped --stop-timeout 40 \
    --label "javascope.ai.config=$config_hash" \
    --pids-limit 256 --memory 1g --memory-swap 1g --cpus 1 \
    --cap-drop ALL --security-opt no-new-privileges \
    --env-file "$env_file" \
    --mount type=volume,src=javascope-ai-data,dst=/app/data \
    --publish 127.0.0.1:20128:20128 "$image" >/dev/null
fi
for attempt in {1..60}; do
  if [[ $(docker inspect --format '{{.State.Health.Status}}' "$name") == healthy ]]; then
    echo 'AI gateway is healthy on 127.0.0.1:20128; credentials and data persist across restarts'
    exit 0
  fi
  sleep 1
done
echo 'AI gateway did not become healthy within 60 seconds' >&2
exit 1
