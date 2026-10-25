#!/usr/bin/env bash
set -euo pipefail
exec 9>/run/lock/javascope-deploy.lock
flock -n 9 || exit 0
source /etc/javascope/deploy.env
export GIT_SSH_COMMAND="ssh -i ${GIT_SSH_KEY} -o BatchMode=yes -o StrictHostKeyChecking=yes"
cache=/opt/javascope/repository.git
if [[ ! -d "$cache" ]]; then
  git init --bare "$cache" >/dev/null
  git --git-dir="$cache" remote add origin "$GIT_REPOSITORY"
fi
git --git-dir="$cache" fetch --quiet --depth=2 origin "$GIT_BRANCH"
revision=$(git --git-dir="$cache" rev-parse FETCH_HEAD)
if [[ -f /var/lib/javascope/deployed-head ]] && [[ $(cat /var/lib/javascope/deployed-head) == "$revision" ]]; then exit 0; fi
release=/opt/javascope/releases/$revision
if [[ ! -d "$release" ]]; then
  mkdir -p "$release"
  git --git-dir="$cache" archive "$revision" backend frontend deploy | tar -x -C "$release"
fi
/bin/bash "$release/deploy/release.sh" "$release" "$revision"
