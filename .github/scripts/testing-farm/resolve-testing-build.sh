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
#
# Resolve the Linux x64 tarball of an openkaiden/testing-prereleases build
# (e.g. v0.4.0-202611050813-f5fd986e6) to its download URL and sha256, and to
# the full SHA of the commit it was built from, which becomes the ref under test
# so the specs match the binary. Writes `url`, `sha256` and `sha` to
# GITHUB_OUTPUT. Requires GH_TOKEN.

set -euo pipefail

tag="${TESTING_BUILD:?TESTING_BUILD is required}"
# TEMPORARY: allow running other specs (INPUT_REF) against the build's binary.
if [[ -n "${INPUT_REF:-}" ]]; then
  echo "::notice::Testing build ${tag} binary with specs from ref ${INPUT_REF}"
fi

# Testing build tags end with the short SHA they were built from.
if [[ ! "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+-[0-9]{12}-([0-9a-f]{7,40})$ ]]; then
  echo "::error::'$tag' is not a testing build tag (vX.Y.Z-YYYYMMDDHHMM-<sha>)"
  exit 1
fi
sha="$(gh api "repos/openkaiden/kaiden/commits/${BASH_REMATCH[1]}" --jq '.sha')"

asset_name="kaiden-${tag#v}-x64.tar.gz"
asset="$(gh api "repos/openkaiden/testing-prereleases/releases/tags/${tag}" \
  --jq ".assets[] | select(.name == \"${asset_name}\") | \"\\(.browser_download_url) \\(.digest)\"")"
read -r url digest <<< "$asset"
if [[ -z "$url" || "$digest" != sha256:* ]]; then
  echo "::error::No ${asset_name} with a sha256 digest found in testing build ${tag}"
  exit 1
fi

echo "Testing build: ${url} (${digest})"
{
  echo "url=${url}"
  echo "sha256=${digest#sha256:}"
  echo "sha=${sha}"
} >> "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"
