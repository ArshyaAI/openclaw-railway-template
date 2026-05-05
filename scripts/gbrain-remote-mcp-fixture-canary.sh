#!/usr/bin/env bash
set -euo pipefail

allowed_project_id="fbdb217b-060f-4f1e-8697-08a6288a19c4"
allowed_environment="production"
allowed_service_id="beab847a-12bb-499e-a44c-bf5d1982924f"
allowed_service_name="gbrain-remote-mcp"
project_id="${GBRAIN_REMOTE_RAILWAY_PROJECT_ID:-$allowed_project_id}"
environment="${GBRAIN_REMOTE_RAILWAY_ENVIRONMENT:-$allowed_environment}"
service_id="${GBRAIN_REMOTE_RAILWAY_SERVICE_ID:-$allowed_service_id}"
forbidden_service_id="63b84308-25d7-4b03-9c23-4d0d7239728f"
allowed_base_url="https://gbrain-remote-mcp-production.up.railway.app"
base_url="${GBRAIN_REMOTE_MCP_URL:-$allowed_base_url}"

if [[ "$service_id" == "$forbidden_service_id" ]]; then
  echo '{"status":"FAIL","error":"refusing forbidden service id"}' >&2
  exit 2
fi

if [[ "$project_id" != "$allowed_project_id" || "$environment" != "$allowed_environment" || "$service_id" != "$allowed_service_id" ]]; then
  echo '{"status":"FAIL","error":"refusing unapproved Remote MCP Railway target"}' >&2
  exit 2
fi

if [[ "$base_url" != "$allowed_base_url" && "${GBRAIN_REMOTE_ALLOW_CUSTOM_URL:-}" != "1" ]]; then
  echo '{"status":"FAIL","error":"refusing unapproved Remote MCP URL"}' >&2
  exit 2
fi

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf '{"status":"FAIL","error":"missing command: %s"}\n' "$1" >&2
    exit 1
  fi
}

require_command railway
require_command node
require_command npm

verify_target() {
  node -e "const expectedId = process.argv[1]; const expectedName = process.argv[2]; let raw = ''; process.stdin.on('data', chunk => { raw += chunk; }); process.stdin.on('end', () => { const service = JSON.parse(raw); if (service.id !== expectedId || service.name !== expectedName) { console.error(JSON.stringify({ status: 'FAIL', error: 'wrong Remote MCP Railway service', expected_service_id: expectedId, got_service_id: service.id, got_service_name: service.name })); process.exit(2); } });" "$allowed_service_id" "$allowed_service_name"
}

tmpdir="$(mktemp -d "${TMPDIR:-/tmp}/gbrain-remote-mcp-target.XXXXXX")"
(
  cd "$tmpdir"
  railway link \
    --project "$project_id" \
    --environment "$environment" \
    --service "$service_id" \
    --json >/dev/null
  railway service status \
    --service "$service_id" \
    --environment "$environment" \
    --json | verify_target
)
rm -rf "$tmpdir"

create_client() {
  local name="$1"
  local scopes="$2"
  railway ssh --project "$project_id" --environment "$environment" --service "$service_id" \
    'sh' '-lc' "cd /app && NO_COLOR=1 bun run src/cli.ts auth register-client '$name' --grant-types client_credentials --scopes '$scopes'" \
    2>/dev/null
}

extract_id() {
  printf '%s\n' "$1" | tr -d '\r' | awk '/Client ID:/ {print $3; exit}'
}

extract_secret() {
  printf '%s\n' "$1" | tr -d '\r' | awk '/Client Secret:/ {print $3; exit}'
}

revoke_client() {
  local client_id="$1"
  [[ -z "$client_id" ]] && return 0
  railway ssh --project "$project_id" --environment "$environment" --service "$service_id" \
    'sh' '-lc' "cd /app && bun run src/cli.ts auth revoke-client '$client_id'" \
    >/dev/null 2>&1 || true
}

main_id=""
expired_id=""
revoked_id=""
log_file=""

cleanup() {
  revoke_client "$main_id"
  revoke_client "$expired_id"
  revoke_client "$revoked_id"
  [[ -n "$log_file" ]] && rm -f "$log_file"
}
trap cleanup EXIT

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
main_reg="$(create_client "remote-mcp-canary-$stamp" 'read write')"
main_id="$(extract_id "$main_reg")"
main_secret="$(extract_secret "$main_reg")"

expired_reg="$(create_client "remote-mcp-expired-$stamp" 'read')"
expired_id="$(extract_id "$expired_reg")"
expired_secret="$(extract_secret "$expired_reg")"

revoked_reg="$(create_client "remote-mcp-revoked-$stamp" 'read')"
revoked_id="$(extract_id "$revoked_reg")"
revoked_secret="$(extract_secret "$revoked_reg")"

if [[ -z "$main_id" || -z "$main_secret" || -z "$expired_id" || -z "$expired_secret" || -z "$revoked_id" || -z "$revoked_secret" ]]; then
  echo '{"status":"FAIL","error":"failed to create OAuth fixture clients"}' >&2
  exit 1
fi

railway ssh --project "$project_id" --environment "$environment" --service "$service_id" \
  'sh' '-lc' "cd /app && CLIENT_ID='$expired_id' bun --eval 'import postgres from \"postgres\"; const sql = postgres(process.env.GBRAIN_DATABASE_URL || process.env.DATABASE_URL, { prepare: false }); await sql.unsafe(\"UPDATE oauth_clients SET token_ttl = 1 WHERE client_id = \\\$1\", [process.env.CLIENT_ID]); await sql.end();'" \
  >/dev/null 2>&1

expired_token="$(CLIENT_ID="$expired_id" CLIENT_SECRET="$expired_secret" BASE_URL="$base_url" node <<'NODE'
const res = await fetch(`${process.env.BASE_URL}/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.CLIENT_ID,
    client_secret: process.env.CLIENT_SECRET,
    scope: 'read',
  }),
});
const json = await res.json().catch(() => ({}));
if (!res.ok || !json.access_token) process.exit(1);
process.stdout.write(json.access_token);
NODE
)"

sleep 2
revoke_client "$revoked_id"

log_file="$(mktemp "${TMPDIR:-/tmp}/gbrain-remote-logs.XXXXXX")"
railway logs --project "$project_id" --service "$service_id" --environment "$environment" --lines 200 --json >"$log_file" 2>/dev/null || true

GBRAIN_REMOTE_MCP_URL="$base_url" \
  GBRAIN_REMOTE_OAUTH_CLIENT_ID="$main_id" \
  GBRAIN_REMOTE_OAUTH_CLIENT_SECRET="$main_secret" \
  GBRAIN_REMOTE_EXPIRED_MCP_BEARER_TOKEN="$expired_token" \
  GBRAIN_REMOTE_REVOKED_OAUTH_CLIENT_ID="$revoked_id" \
  GBRAIN_REMOTE_REVOKED_OAUTH_CLIENT_SECRET="$revoked_secret" \
  GBRAIN_REMOTE_LOG_SAMPLE_FILE="$log_file" \
  npm run canary:gbrain-remote

printf '{"oauth_fixture_clients_revoked":true,"remote_mcp_target_verified":true,"project_id":"%s","environment":"%s","service_id":"%s","service_name":"%s"}\n' \
  "$project_id" \
  "$environment" \
  "$service_id" \
  "$allowed_service_name"
