#!/bin/bash
#
# SPDX-FileCopyrightText: Copyright (c) 2026 Red Hat, Inc.
# SPDX-License-Identifier: Apache-2.0
#
# Runs inside the sandbox through the agent setupCommand after creation. It
# replaces the __ANTHROPIC_API_KEY_SUFFIX__ placeholder written by
# preWorkspaceStart with the last 20 characters of the provider-injected
# ANTHROPIC_API_KEY (the whole key when it is shorter), so Claude Code does
# not prompt for API key confirmation. Vertex AI workspaces are skipped:
# they authenticate through ANTHROPIC_AUTH_TOKEN and never receive
# ANTHROPIC_API_KEY. Any failure exits non-zero, which fails the workspace
# creation.
set -e
if [ -n "${ANTHROPIC_API_KEY:-}" ] && [ "${CLAUDE_CODE_USE_VERTEX:-}" != "1" ]; then
  CLAUDE_JSON="$HOME/.claude.json"
  content="$(<"$CLAUDE_JSON")"
  if [[ "$content" != *"__ANTHROPIC_API_KEY_SUFFIX__"* ]]; then
    echo "approve-key: __ANTHROPIC_API_KEY_SUFFIX__ not found in $CLAUDE_JSON" >&2
    exit 1
  fi
  suffix="$ANTHROPIC_API_KEY"
  if [ "${#ANTHROPIC_API_KEY}" -gt 20 ]; then
    suffix="${ANTHROPIC_API_KEY: -20}"
  fi
  printf '%s\n' "${content//__ANTHROPIC_API_KEY_SUFFIX__/"$suffix"}" > "$CLAUDE_JSON"
fi
