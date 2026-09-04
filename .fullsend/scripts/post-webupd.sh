#!/usr/bin/env bash
set -euo pipefail

WEBSITE_REPO="openkaiden/website"

echo "Validating FULLSEND_VALIDATED_ITERATION_DIR  ${FULLSEND_VALIDATED_ITERATION_DIR:-} and FULLSEND_OUTPUT_DIR ${FULLSEND_OUTPUT_DIR:-}"
echo "Validating files are ${FULLSEND_VALIDATED_ITERATION_DIR}/files"

# Prefer the validated iteration directory set by the harness
if [[ -n "${FULLSEND_VALIDATED_ITERATION_DIR:-}" ]]; then
  RESULT_FILE="${FULLSEND_VALIDATED_ITERATION_DIR}/agent-result.json"
  FILES_DIR="${FULLSEND_VALIDATED_ITERATION_DIR}/files"
else
  RESULT_FILE=""
  FILES_DIR=""
  for dir in iteration-*/output; do
    if [[ -f "${dir}/agent-result.json" ]]; then
      RESULT_FILE="${dir}/agent-result.json"
      FILES_DIR="${dir}/files"
    fi
  done
fi

if [[ -z "${RESULT_FILE}" ]] || [[ ! -f "${RESULT_FILE}" ]]; then
  echo "ERROR: agent-result.json not found"
  exit 1
fi

if ! jq empty "${RESULT_FILE}" 2>/dev/null; then
  echo "ERROR: agent-result.json is not valid JSON"
  exit 1
fi

STATUS=$(jq -r '.status // ""' "${RESULT_FILE}")

# Log audit summary if present
if jq -e '.audit_summary' "${RESULT_FILE}" &>/dev/null; then
  echo "Audit summary:"
  jq '.audit_summary' "${RESULT_FILE}"
fi

case "${STATUS}" in
  no_changes)
    echo "No website changes needed. Exiting."
    exit 0
    ;;
  changes_found)
    echo "Agent found changes to apply."
    ;;
  error)
    echo "Agent reported an error."
    jq -r '.pr_body // "No details"' "${RESULT_FILE}"
    exit 1
    ;;
  *)
    echo "ERROR: Unknown or missing status '${STATUS}'"
    exit 1
    ;;
esac

if [[ ! -d "${FILES_DIR}" ]]; then
  echo "ERROR: No files directory found at ${FILES_DIR}"
  exit 1
fi

PR_TITLE=$(jq -r '.pr_title // "docs: automated website update"' "${RESULT_FILE}")
PR_BODY=$(jq -r '.pr_body // "Automated update from webupd agent."' "${RESULT_FILE}")

BRANCH_NAME="${WEBSITE_BRANCH_NAME:-fullsend/website-update}"

# Use WEBSITE_GH_TOKEN for cross-repo access, fall back to GH_TOKEN
PUSH_TOKEN="${WEBSITE_GH_TOKEN:-${GH_TOKEN}}"

# Check for existing open PRs from the configured branch to avoid duplicates
EXISTING_PR=$(GH_TOKEN="${PUSH_TOKEN}" gh pr list \
  --repo "${WEBSITE_REPO}" \
  --head "${BRANCH_NAME}" \
  --state open \
  --json number \
  --jq '.[0].number // empty' 2>/dev/null || true)

if [[ -n "${EXISTING_PR}" ]]; then
  echo "Found existing open PR #${EXISTING_PR} for branch ${BRANCH_NAME}. Will update it."
fi

if [[ -z "${WEBSITE_REPO_DIR:-}" || ! -d "${WEBSITE_REPO_DIR}" ]]; then
  echo "ERROR: WEBSITE_REPO_DIR not set or not found at '${WEBSITE_REPO_DIR:-}'"
  exit 1
fi

cd "${WEBSITE_REPO_DIR}"
git checkout -b "${BRANCH_NAME}"

# Apply changes from agent output
CHANGES_APPLIED=0
while IFS= read -r file; do
  rel_path="${file#${FILES_DIR}/}"
  dest="${WEBSITE_REPO_DIR}/${rel_path}"
  mkdir -p "$(dirname "${dest}")"
  cp "${file}" "${dest}"
  git add "${rel_path}"
  CHANGES_APPLIED=$((CHANGES_APPLIED + 1))
  echo "Applied: ${rel_path}"
done < <(find "${FILES_DIR}" -type f)

if [[ "${CHANGES_APPLIED}" -eq 0 ]]; then
  echo "No files to apply. Exiting."
  exit 0
fi

# Show diff stats before committing
echo "Changes to commit:"
git --no-pager diff --cached --stat

git config --local user.name "openkaiden-bot"
git config --local user.email "233296430+openkaiden-bot@users.noreply.github.com"


git commit -m "${PR_TITLE}"

echo "Pushing branch ${BRANCH_NAME}..."
git push origin "+${BRANCH_NAME}"

if [[ -n "${EXISTING_PR}" ]]; then
  echo "Updated existing PR #${EXISTING_PR} for ${BRANCH_NAME}."
else
  echo "Creating PR..."
  if ! GH_TOKEN="${PUSH_TOKEN}" gh pr create \
    --repo "${WEBSITE_REPO}" \
    --base main \
    --head "${BRANCH_NAME}" \
    --title "${PR_TITLE}" \
    --body "${PR_BODY}" \
    --label "documentation"; then
    EXISTING_PR=$(GH_TOKEN="${PUSH_TOKEN}" gh pr list \
      --repo "${WEBSITE_REPO}" \
      --head "${BRANCH_NAME}" \
      --state open \
      --json number \
      --jq '.[0].number // empty' 2>/dev/null || true)

    if [[ -n "${EXISTING_PR}" ]]; then
      echo "Detected existing PR #${EXISTING_PR} after create attempt; treated as update."
    else
      echo "ERROR: Failed to create PR and could not find an existing open PR for ${BRANCH_NAME}."
      exit 1
    fi
  fi
fi

echo "Post-script complete."
