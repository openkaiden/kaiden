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

# Bump the OpenShell binary version and the matching SDK, then refresh the lockfile.
# Usage: bump-openshell.sh <version>

set -euo pipefail

NEW="${1:?usage: $0 <version>}"
SDK="npm:@openkaiden/opnshll-sdk@$NEW"

# set_json <file> <value> <jq filter using $v>; fails (jq -e) if the filter yields false/null
set_json() {
  local tmp
  tmp=$(mktemp)
  jq -e --arg v "$2" "$3" "$1" > "$tmp"
  mv "$tmp" "$1"
}

set_json extensions/openshell/package.json "$NEW" 'select(has("openshellVersion")) | .openshellVersion = $v'
for f in package.json packages/extension-api/package.json; do
  set_json "$f" "$SDK" 'select(.dependencies | has("@nvidia/openshell-sdk")) | .dependencies["@nvidia/openshell-sdk"] = $v'
done

pnpm install --lockfile-only
