#!/usr/bin/env bash
set -euo pipefail

WORKSPACE="/tmp/workspace"
mkdir -p "$WORKSPACE"

KDN_REPO="$(cd "$(dirname "$0")/../.." && pwd)"

echo "KDN repo is at ${KDN_REPO}"

echo "=== Extracting Kaiden feature info from ${KDN_REPO} ==="

# --- 1. Extract extension info with full configuration properties ---
extensions_json="[]"
for ext_dir in "${KDN_REPO}"/extensions/*/; do
  [[ -f "${ext_dir}/package.json" ]] || continue

  ext_name=$(basename "$ext_dir")

  # Full metadata including contributes.configuration (not just keys)
  ext_info=$(jq -c '{
    name: .name,
    displayName: (.displayName // .name),
    description: (.description // ""),
    keywords: (.keywords // []),
    contributes_configuration: (.contributes.configuration // null)
  }' "${ext_dir}/package.json" 2>/dev/null || echo '{}')

  # Classify extension type by scanning source code
  is_agent="false"
  is_provider="false"
  if [[ -d "${ext_dir}/src" ]]; then
    if grep -rql "registerAgent\|CodingAgentProvider\|FlowProvider" "${ext_dir}/src" 2>/dev/null; then
      is_agent="true"
    fi
    if grep -rql "registerInferenceProvider\|InferenceProvider\|createProvider" "${ext_dir}/src" 2>/dev/null; then
      is_provider="true"
    fi
  fi

  if [[ "$is_agent" == "true" && "$is_provider" == "true" ]]; then
    ext_type="both"
  elif [[ "$is_agent" == "true" ]]; then
    ext_type="agent"
  elif [[ "$is_provider" == "true" ]]; then
    ext_type="inferenceProvider"
  else
    ext_type="utility"
  fi

  ext_info=$(echo "$ext_info" | jq -c --arg t "$ext_type" '. + {extensionType: $t}')
  extensions_json=$(echo "$extensions_json" | jq --argjson ext "$ext_info" '. + [$ext]')
done

echo "Extracted $(echo "$extensions_json" | jq 'length') extensions"

# --- 2. Extract built-in Preferences from main process ---
builtin_prefs="[]"
while IFS= read -r ts_file; do
  source_file=$(basename "$ts_file")
  # Extract first id: and title: values from the file (these are IConfigurationNode fields)
  id=$(grep -oE "id:[[:space:]]*['\"][^'\"]+['\"]" "$ts_file" 2>/dev/null | head -1 | sed -E "s/^id:[[:space:]]*['\"]//;s/['\"]$//" || true)
  title=$(grep -oE "title:[[:space:]]*['\"][^'\"]+['\"]" "$ts_file" 2>/dev/null | head -1 | sed -E "s/^title:[[:space:]]*['\"]//;s/['\"]$//" || true)
  if [[ -n "$id" && -n "$title" ]]; then
    builtin_prefs=$(echo "$builtin_prefs" | jq \
      --arg id "$id" \
      --arg title "$title" \
      --arg source "$source_file" \
      '. + [{"id": $id, "title": $title, "source": $source}]')
  fi
done < <(grep -rl "registerConfigurations" \
  "${KDN_REPO}/packages/main/src/plugin/" \
  "${KDN_REPO}/packages/main/src/system/" \
  --include="*.ts" 2>/dev/null | grep -v spec | grep -v node_modules | grep -v configuration-registry.ts)

# Deduplicate by id
builtin_prefs=$(echo "$builtin_prefs" | jq '[group_by(.id)[] | first]')

echo "Extracted $(echo "$builtin_prefs" | jq 'length') built-in preference sections"

# --- 3. Extract project overview from CLAUDE.md / AGENTS.md ---
project_overview=""
if [[ -f "${KDN_REPO}/CLAUDE.md" ]]; then
  project_overview=$(cat "${KDN_REPO}/CLAUDE.md")
elif [[ -f "${KDN_REPO}/AGENTS.md" ]]; then
  project_overview=$(cat "${KDN_REPO}/AGENTS.md")
fi

# --- 4. Get recent significant changes (last 30 days) ---
recent_changes=""
if git -C "${KDN_REPO}" rev-parse --is-inside-work-tree &>/dev/null; then
  recent_changes=$(git -C "${KDN_REPO}" log --since="30 days ago" \
    --pretty=format:"%h %s" --no-merges 2>/dev/null | head -50 || true)
fi

# --- 5. Get extension API surface ---
extension_api_exports=""
if [[ -f "${KDN_REPO}/packages/extension-api/src/extension-api.d.ts" ]]; then
  extension_api_exports=$(grep -E '^export|^  export' \
    "${KDN_REPO}/packages/extension-api/src/extension-api.d.ts" 2>/dev/null \
    | head -100 || true)
fi

# --- 6. Read website content from pre-checked-out repo ---
website_docs="[]"
website_hero_svelte=""
website_sidebar=""

if [[ -n "${WEBSITE_REPO_DIR:-}" && -d "${WEBSITE_REPO_DIR}" ]]; then
  echo "Reading website content from ${WEBSITE_REPO_DIR} ..."

  if [[ -d "${WEBSITE_REPO_DIR}/docs/content" ]]; then
    for md_file in "${WEBSITE_REPO_DIR}"/docs/content/*.md; do
      [[ -f "$md_file" ]] || continue
      filename=$(basename "$md_file")
      content=$(cat "$md_file")
      website_docs=$(echo "$website_docs" | jq \
        --arg file "$filename" \
        --arg content "$content" \
        '. + [{"file": $file, "content": $content}]')
    done
  fi

  if [[ -f "${WEBSITE_REPO_DIR}/src/lib/components/Hero.svelte" ]]; then
    website_hero_svelte=$(cat "${WEBSITE_REPO_DIR}/src/lib/components/Hero.svelte")
  fi

  if [[ -f "${WEBSITE_REPO_DIR}/docs/sidebars.ts" ]]; then
    website_sidebar=$(cat "${WEBSITE_REPO_DIR}/docs/sidebars.ts")
  fi

  echo "Captured $(echo "$website_docs" | jq 'length') website doc files"
else
  echo "WARNING: WEBSITE_REPO_DIR not set or not found. Agent will run without website content."
fi

# --- 7. Build the output JSON ---
echo "Writing the file kdn-info.json to ${WORKSPACE}/kdn-info.json"
jq -n \
  --argjson extensions "$extensions_json" \
  --argjson builtin_preferences "$builtin_prefs" \
  --argjson website_docs "$website_docs" \
  --arg website_hero_svelte "$website_hero_svelte" \
  --arg website_sidebar "$website_sidebar" \
  --arg project_overview "$project_overview" \
  --arg recent_changes "$recent_changes" \
  --arg extension_api "$extension_api_exports" \
  '{
    extensions: $extensions,
    builtin_preferences: $builtin_preferences,
    website_docs: $website_docs,
    website_hero_svelte: $website_hero_svelte,
    website_sidebar: $website_sidebar,
    project_overview: $project_overview,
    recent_changes: $recent_changes,
    extension_api_surface: $extension_api
  }' > "${WORKSPACE}/kdn-info.json"

echo "Wrote kdn-info.json ($(wc -c < "${WORKSPACE}/kdn-info.json") bytes)"
echo "Pre-script complete."
