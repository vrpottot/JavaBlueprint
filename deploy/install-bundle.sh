#!/usr/bin/env bash
set -euo pipefail
archive=$1
revision=$2
[[ "$archive" == /opt/javascope/incoming/* && "$revision" =~ ^[a-f0-9]{40}$ ]] || exit 1
exec 9>/run/lock/javascope-deploy.lock
flock -w 300 9
trap 'rm -f -- "$archive"' EXIT
latest=$(python3 -c 'import json; print(json.load(open("/opt/javascope/incoming/latest-run.json"))["sha"])')
if [[ "$latest" != "$revision" ]]; then echo 'Skipping a superseded release'; exit 0; fi
if [[ -f /var/lib/javascope/deployed-head ]] && [[ $(cat /var/lib/javascope/deployed-head) == "$revision" ]]; then exit 0; fi
release=/opt/javascope/releases/$revision
if [[ ! -d "$release" ]]; then
  python3 - "$archive" "$release" <<'PY'
import sys, tarfile, pathlib, shutil
archive, destination = sys.argv[1:]
stage = pathlib.Path(destination + '.incoming')
if stage.exists(): shutil.rmtree(stage)
stage.mkdir(mode=0o700)
try:
    total = count = 0
    with tarfile.open(archive, mode='r|gz') as tar:
        for member in tar:
            count += 1
            total += max(0, member.size)
            if count > 20000 or total > 128 * 1024 * 1024:
                raise ValueError('Source archive exceeds extraction limits')
            tar.extract(member, path=stage, filter='data')
    if not (stage / 'backend/package.json').is_file() or not (stage / 'deploy/release.sh').is_file():
        raise ValueError('Invalid source layout')
    stage.chmod(0o755)
    stage.rename(destination)
except BaseException:
    shutil.rmtree(stage, ignore_errors=True)
    raise
PY
fi
bash "$release/deploy/release.sh" "$release" "$revision"
