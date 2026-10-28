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
# Validate the ref a Testing Farm run should test and pin it to an immutable
# commit SHA. The repository is always this repository (CURRENT_REPOSITORY); the
# ref defaults to the dispatch ref unless INPUT_REF overrides it. Writes the
# resolved `repository` and `sha` to GITHUB_OUTPUT. Kept out of the workflow YAML
# so it can be run and tested locally.

set -euo pipefail

repository="${CURRENT_REPOSITORY:?CURRENT_REPOSITORY is required}"
ref="${INPUT_REF:-${CURRENT_REF:?CURRENT_REF is required}}"

# Defense in depth behind the job's `if: github.repository == 'openkaiden/kaiden'`:
# the provider secrets must only ever reach this exact upstream repository.
if [[ "$repository" != "openkaiden/kaiden" ]]; then
  echo "::error::Only openkaiden/kaiden may run this workflow"
  exit 1
fi

# Reject whitespace / ';' / leading '-' (shell-syntax smuggling) and refs/pull/*
# (a fork PR head). Hardening only: the real trust boundary is who can dispatch.
if [[ "$ref" =~ [[:space:]] || "$ref" == *";"* || "$ref" == -* || "$ref" == refs/pull/* ]]; then
  echo "::error::Ref must be a branch, tag, or full SHA (no refs/pull/*, whitespace, ';', or leading '-')"
  exit 1
fi

# Pin to an immutable commit SHA. Query exact refs (branch, then peeled tag, then
# lightweight tag) to avoid `git ls-remote`'s tail-matching ambiguity, and accept
# only a full 40-char SHA passed directly so we fail here rather than at fetch
# time (GitHub cannot `fetch --depth 1` an abbreviated SHA).
url="https://github.com/${repository}.git"
sha="$(git ls-remote "$url" "refs/heads/${ref}" | awk 'NR==1{print $1}')"
if [ -z "$sha" ]; then
  sha="$(git ls-remote "$url" "refs/tags/${ref}^{}" | awk 'NR==1{print $1}')"
fi
if [ -z "$sha" ]; then
  sha="$(git ls-remote "$url" "refs/tags/${ref}" | awk 'NR==1{print $1}')"
fi
if [ -z "$sha" ]; then
  if [[ "$ref" =~ ^[0-9a-fA-F]{40}$ ]]; then
    sha="$ref"
  else
    echo "::error::Could not resolve ref '$ref' to a branch, tag, or full 40-char SHA"
    exit 1
  fi
fi

echo "Testing $repository at $sha ($ref)"
{
  echo "repository=$repository"
  echo "sha=$sha"
} >> "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"
