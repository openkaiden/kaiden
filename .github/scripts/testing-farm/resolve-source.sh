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
# Resolve and validate the repository/ref a Testing Farm run should test and pin
# it to an immutable commit SHA. Reads INPUT_REPOSITORY/INPUT_REF (workflow
# inputs) with CURRENT_REPOSITORY/CURRENT_REF as defaults, and writes the
# resolved `repository` and `sha` to GITHUB_OUTPUT. Kept out of the workflow YAML
# so it can be run and tested locally.

set -euo pipefail

repository="${INPUT_REPOSITORY:-${CURRENT_REPOSITORY:?CURRENT_REPOSITORY is required}}"
ref="${INPUT_REF:-${CURRENT_REF:?CURRENT_REF is required}}"

if [[ ! "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
  echo "::error::Repository must use owner/repo format"
  exit 1
fi

# Provider secrets are exposed to the tmt plan/script of the repository under
# test, so only allow repositories from the upstream org.
if [[ "$repository" != openkaiden/* ]]; then
  echo "::error::Only openkaiden/* repositories may run this workflow"
  exit 1
fi

# Reject whitespace / ';' / leading '-' (shell-syntax smuggling) and refs/pull/*.
# This is hardening, not a guarantee: the real trust boundary is who can dispatch
# (write access), and a resolved SHA can still point at a fork PR commit the
# upstream repo serves.
if [[ "$ref" =~ [[:space:]] || "$ref" == *";"* || "$ref" == -* || "$ref" == refs/pull/* ]]; then
  echo "::error::Ref must be a branch, tag, or SHA (no refs/pull/*, whitespace, ';', or leading '-')"
  exit 1
fi

# Pin to an immutable commit SHA so the Testing Farm plan checkout and the
# script's own fetch test the same source even if the branch moves in between.
sha="$(git ls-remote "https://github.com/${repository}.git" "$ref" | awk 'NR==1{print $1}')"
if [ -z "$sha" ]; then
  if [[ "$ref" =~ ^[0-9a-fA-F]{7,40}$ ]]; then
    sha="$ref"
  else
    echo "::error::Could not resolve ref '$ref' to a commit SHA"
    exit 1
  fi
fi

echo "Testing $repository at $sha ($ref)"
{
  echo "repository=$repository"
  echo "sha=$sha"
} >> "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"
