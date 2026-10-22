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
# Testing Farm checks out the repo for tmt, but with tmt_path=tests/tmt the tmt
# metadata tree ($TMT_TREE) is tests/tmt, not a build-ready source root at a
# stable path. Clone the pinned SHA into a clean workdir to build Kaiden.
git clone --filter=blob:none --no-checkout "https://github.com/${KAIDEN_REPOSITORY}.git" "$repo_dir"
git -C "$repo_dir" fetch --depth 1 origin "$KAIDEN_REF"
git -C "$repo_dir" checkout --detach FETCH_HEAD
cd "$repo_dir"

if [[ ! -f .nvmrc ]]; then
  echo 'Missing .nvmrc in the checked out source tree' >&2
  exit 1
fi

# This plan pins arch: x86_64; fail clearly if it ever lands on another guest
# rather than failing later on the hardcoded linux-x64 Node tarball.
arch="$(uname -m)"
if [ "$arch" != "x86_64" ]; then
  echo "workspace-provider plan supports x86_64 only (got ${arch})" >&2
  exit 1
fi

# Install Node into /usr/local and enable corepack with sudo (system-level setup),
# then run the suite as the unprivileged Testing Farm user so Podman is rootless —
# mirroring the podman-desktop Testing Farm plan.
node_version="$(tr -d '[:space:]' < .nvmrc)"
node_tarball="node-v${node_version}-linux-x64.tar.xz"
node_base="https://nodejs.org/dist/v${node_version}"
# Verify the tarball against the official checksum before extracting it.
curl --fail --silent --show-error --location -O "${node_base}/${node_tarball}"
curl --fail --silent --show-error --location -O "${node_base}/SHASUMS256.txt"
grep " ${node_tarball}\$" SHASUMS256.txt | sha256sum -c -
sudo tar -xJ --strip-components=1 -C /usr/local -f "${node_tarball}"
rm -f "${node_tarball}" SHASUMS256.txt
# corepack reads the pinned pnpm version from package.json's packageManager field,
# so there is nothing to hardcode here.
sudo corepack enable
node --version
pnpm --version

mkdir -p "$test_data_dir"

# Testing Farm publishes $TMT_TEST_DATA as (publicly readable) artifacts, and the
# workspace specs type provider API keys into the UI, so Playwright traces,
# videos and screenshots can contain them in clear text. Build a redaction list
# from the keys present in the environment for the sibling sanitizer to use.
secrets_file="$(mktemp)"
chmod 600 "$secrets_file"
for key in ANTHROPIC_API_KEY OPENAI_API_KEY GEMINI_API_KEY MISTRAL_API_KEY; do
  if [ -n "${!key:-}" ]; then
    printf '%s=%s\n' "$key" "${!key}" >> "$secrets_file"
  fi
done

cleanup() {
  if [[ -d tests/playwright/output ]]; then
    dest="$test_data_dir/playwright-output"
    mkdir -p "$dest"
    # Exclude traces/videos/screenshots: they can embed the typed-in keys and
    # cannot be reliably redacted. Publish only the (text) remainder.
    tar -C tests/playwright/output \
      --exclude='*.zip' --exclude='*.webm' --exclude='*.png' \
      --exclude='*.jpg' --exclude='*.jpeg' -cf - . | tar -C "$dest" -xf -
    # Redact any provider keys that still appear in the text artifacts.
    SECRETS_FILE="$secrets_file" bash .github/scripts/pde2e/sanitize-collected-logs.sh "$dest" || true
  fi
  rm -f "$secrets_file"
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
