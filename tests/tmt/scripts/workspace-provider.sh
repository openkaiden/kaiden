#!/usr/bin/env bash
#
# Copyright (C) 2026 Red Hat, Inc.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

: "${KAIDEN_REPOSITORY:?Testing Farm did not provide KAIDEN_REPOSITORY}"
: "${KAIDEN_REF:?Testing Farm did not provide KAIDEN_REF}"

repo_dir="$(mktemp -d /tmp/kaiden-e2e.XXXXXX)"
test_data_dir="$TMT_TEST_DATA"
# tmt_path=tests/tmt scopes plan discovery to the tmt tree, which does not contain
# the application source needed to build and run Kaiden. Clone the full repo here.
git clone --filter=blob:none --no-checkout "https://github.com/${KAIDEN_REPOSITORY}.git" "$repo_dir"
git -C "$repo_dir" fetch --depth 1 origin "$KAIDEN_REF"
git -C "$repo_dir" checkout --detach FETCH_HEAD
cd "$repo_dir"

if [[ ! -f .nvmrc ]]; then
  echo 'Missing .nvmrc in the checked out source tree' >&2
  exit 1
fi

node_version="$(tr -d '[:space:]' < .nvmrc)"
node_tarball="node-v${node_version}-linux-x64.tar.xz"
node_base="https://nodejs.org/dist/v${node_version}"
# Verify the tarball against the official checksum before extracting it as root.
curl --fail --silent --show-error --location -O "${node_base}/${node_tarball}"
curl --fail --silent --show-error --location -O "${node_base}/SHASUMS256.txt"
grep " ${node_tarball}\$" SHASUMS256.txt | sha256sum -c -
tar -xJ --strip-components=1 -C /usr/local -f "${node_tarball}"
rm -f "${node_tarball}" SHASUMS256.txt
# corepack reads the pinned pnpm version from package.json's packageManager field,
# so there is nothing to hardcode here.
corepack enable
node --version
pnpm --version

mkdir -p "$test_data_dir"
cleanup() {
  if [[ -d tests/playwright/output ]]; then
    cp -R tests/playwright/output "$test_data_dir/playwright-output"
  fi
}
trap cleanup EXIT

export PODMAN_ENABLED=true
export VITE_CI=true

pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm run test:e2e:build
# Delegate to the same script the Azure/MAPT Windows workflow runs so both
# platforms execute one identical Workspace-Provider suite (including the
# filesystem/network matrix). Running under `pnpm run` puts node_modules/.bin on
# PATH, so the script's own xvfb-maybe resolves without any workaround here.
pnpm run test:e2e:workspaces:run
