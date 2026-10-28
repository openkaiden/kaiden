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
# Download the sanitized Playwright JUnit report of a Testing Farm run to
# junit-playwright-results.xml. Kept out of the workflow YAML so it can be run
# locally: TF_ARTIFACTS_URL=https://artifacts.dev.testing-farm.io/<request-id>.

set -euo pipefail

artifacts_url="${TF_ARTIFACTS_URL:?TF_ARTIFACTS_URL is required}"

curl --fail --silent --show-error --location -o tf-results.xml "${artifacts_url}/results.xml"
# results.xml links each test case's $TMT_TEST_DATA dir as <log name="data">;
# tests/tmt/scripts/workspace-provider.sh copies the sanitized Playwright
# reports into its playwright-output/ subdirectory.
test_data_url="$(python3 -I -c '
import sys, xml.etree.ElementTree as ET
for case in ET.parse(sys.argv[1]).iter("testcase"):
    if case.get("name") == "/tests/workspace-provider":
        for log in case.iter("log"):
            if log.get("name") == "data":
                print(log.get("href"))
                sys.exit()
' tf-results.xml)"
if [[ -z "$test_data_url" ]]; then
  echo "::error::No /tests/workspace-provider data link found in ${artifacts_url}/results.xml" >&2
  exit 1
fi
curl --fail --silent --show-error --location -o junit-playwright-results.xml \
  "${test_data_url}/playwright-output/junit-results.xml"
