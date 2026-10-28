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
: "${KAIDEN_TEST_USER:?the tmt plan did not provide KAIDEN_TEST_USER}"

# Testing Farm runs tests as root. Do the system-level setup (Node) here, then
# re-run as the unprivileged user the plan's prepare step created so Podman is
# rootless (OpenShell requires it) and that user needs no sudo. runuser keeps
# the environment (provider keys, tmt variables) apart from HOME/USER.
if [ "$(id -u)" -eq 0 ]; then
  # This plan pins arch: x86_64; fail clearly if it ever lands on another guest
  # rather than failing later on the hardcoded linux-x64 Node tarball.
  arch="$(uname -m)"
  if [ "$arch" != "x86_64" ]; then
    echo "workspace-provider plan supports x86_64 only (got ${arch})" >&2
    exit 1
  fi

  # Install the Node version pinned in .nvmrc at the tested SHA into /usr/local,
  # verifying the tarball against the official checksum before extracting it.
  node_dir="$(mktemp -d)"
  curl --fail --silent --show-error --location -o "$node_dir/.nvmrc" \
    "https://raw.githubusercontent.com/${KAIDEN_REPOSITORY}/${KAIDEN_REF}/.nvmrc"
  node_version="$(tr -d '[:space:]' < "$node_dir/.nvmrc")"
  node_tarball="node-v${node_version}-linux-x64.tar.xz"
  node_base="https://nodejs.org/dist/v${node_version}"
  curl --fail --silent --show-error --location -o "$node_dir/${node_tarball}" "${node_base}/${node_tarball}"
  curl --fail --silent --show-error --location -o "$node_dir/SHASUMS256.txt" "${node_base}/SHASUMS256.txt"
  (cd "$node_dir" && grep " ${node_tarball}\$" SHASUMS256.txt | sha256sum -c -)
  tar -xJ --strip-components=1 -C /usr/local -f "$node_dir/${node_tarball}"
  rm -rf "$node_dir"
  # corepack reads the pinned pnpm version from package.json's packageManager
  # field, so there is nothing to hardcode here.
  corepack enable
  node --version

  uid="$(id -u "$KAIDEN_TEST_USER")"
  mkdir -p "$TMT_TEST_DATA"
  chown -R "$KAIDEN_TEST_USER" "$TMT_TEST_DATA"
  # Copy the script where the user can read it; cleanup deletes the copy.
  KAIDEN_SCRIPT_COPY="$(mktemp /tmp/workspace-provider.XXXXXX.sh)"
  cp "$0" "$KAIDEN_SCRIPT_COPY"
  chown "$KAIDEN_TEST_USER" "$KAIDEN_SCRIPT_COPY"
  export KAIDEN_SCRIPT_COPY
  export XDG_RUNTIME_DIR="/run/user/$uid"
  export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"
  cd /tmp
  exec runuser -u "$KAIDEN_TEST_USER" -- bash "$KAIDEN_SCRIPT_COPY"
fi

# This job covers the OpenAI and Gemini providers only: ANTHROPIC_API_KEY and
# MISTRAL_API_KEY are not available to this repo (the workflow receives them
# empty), so Claude and Mistral scenarios skip by design (requiredResource).
# Fail fast if a covered key is missing so its scenarios can't skip silently.
for key in OPENAI_API_KEY GEMINI_API_KEY; do
  if [ -z "${!key:-}" ]; then
    echo "Missing required provider secret ${key}; scenarios would silently skip" >&2
    exit 1
  fi
done

repo_dir="$(mktemp -d /tmp/kaiden-e2e.XXXXXX)"
test_data_dir="$TMT_TEST_DATA"
# The tmt tree ($TMT_TREE) is only tests/tmt, so fetch just the pinned SHA into
# a clean workdir to build Kaiden.
git -C "$repo_dir" init --quiet
git -C "$repo_dir" remote add origin "https://github.com/${KAIDEN_REPOSITORY}.git"
git -C "$repo_dir" fetch --depth 1 origin "$KAIDEN_REF"
git -C "$repo_dir" checkout --detach FETCH_HEAD
cd "$repo_dir"
pnpm --version

mkdir -p "$test_data_dir"

# Testing Farm publishes $TMT_TEST_DATA as (publicly readable) artifacts, and the
# workspace specs type provider API keys into the UI, so Playwright traces,
# videos, screenshots and the HTML report can contain them in clear text. Build a
# redaction list from the provider keys for the sibling sanitizer (mktemp already
# creates the file mode 0600).
secrets_file="$(mktemp)"
for key in OPENAI_API_KEY GEMINI_API_KEY; do
  printf '%s=%s\n' "$key" "${!key}" >> "$secrets_file"
done

cleanup() {
  # Best effort: a failing copy must not replace the suite's real exit status.
  set +e
  if [[ -d tests/playwright/output ]]; then
    dest="$test_data_dir/playwright-output"
    mkdir -p "$dest"
    # Allow-list only the plain-text reports the sanitizer can redact
    # (test-results.json, junit-results.xml, *.log). Everything else is dropped
    # by default: traces, videos and screenshots embed the typed-in keys, the
    # HTML report embeds the data as base64, and error-context.md holds page
    # snapshots — none can be reliably redacted.
    while IFS= read -r -d '' file; do
      rel="${file#tests/playwright/output/}"
      mkdir -p "$dest/$(dirname "$rel")"
      cp "$file" "$dest/$rel"
    done < <(find tests/playwright/output -type f \
      \( -name 'test-results.json' -o -name 'junit-results.xml' -o -name '*.log' \) -print0)
    # Fail closed: if redaction fails, drop the artifacts rather than publish
    # unredacted provider keys.
    if ! SECRETS_FILE="$secrets_file" bash .github/scripts/pde2e/sanitize-collected-logs.sh "$dest"; then
      echo "::error::artifact sanitization failed; dropping collected artifacts" >&2
      rm -rf "$dest"
    fi
  fi
  rm -rf "$repo_dir"
  rm -f "$secrets_file" "${KAIDEN_SCRIPT_COPY:-}"
}
trap cleanup EXIT

export PODMAN_ENABLED=true
export VITE_CI=true
# Forward Electron main stderr (incl. the OpenShell gateway) and renderer console.
export KAIDEN_E2E_VERBOSE_LOGS=true

pnpm install --frozen-lockfile
pnpm exec playwright install chromium
# Same steps as `pnpm run test:e2e:workspaces` (the suite the Windows workflow
# runs), split only so the run output can go to a *.log that cleanup redacts and
# publishes; tmt publishes stdout (output.txt) unredacted.
pnpm run test:e2e:build
mkdir -p tests/playwright/output
echo "Workspace-Provider run output: playwright-output/workspace-provider-run.log"
pnpm run test:e2e:workspaces:run > tests/playwright/output/workspace-provider-run.log 2>&1
