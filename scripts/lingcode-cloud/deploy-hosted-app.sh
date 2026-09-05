#!/usr/bin/env bash
# Creates (first run) and deploys the AutoYT server as a LingCode Cloud hosted app.
#
#   LINGCODE_TOKEN       account token (defaults to the one in .mcp.json)
#   LINGCODE_BACKEND_ID  backend id (defaults to the first backend on the account)
#   LINGCODE_APP_NAME    hosted app slug (default: autoyt) -> https://<slug>.apps.lingcode.app
#
# Usage: scripts/lingcode-cloud/deploy-hosted-app.sh [bundle.tgz]
set -euo pipefail
cd "$(dirname "$0")/../.."
API=${LINGCODE_API_BASE:-https://lingcode.dev}
APP_NAME=${LINGCODE_APP_NAME:-autoyt}
BUNDLE=${1:-tmp/lingcode-app-source.tgz}
TOKEN=${LINGCODE_TOKEN:-}
if [ -z "$TOKEN" ] && [ -f .mcp.json ]; then
  TOKEN=$(python3 -c "import json;print(json.load(open('.mcp.json'))['mcpServers']['lingcode-cloud']['env']['LINGCODE_TOKEN'])" 2>/dev/null || true)
fi
[ -n "$TOKEN" ] || { echo "LINGCODE_TOKEN is not set." >&2; exit 1; }
[ -f "$BUNDLE" ] || scripts/lingcode-cloud/build-app-bundle.sh "$BUNDLE"

auth=(-H "Authorization: Bearer $TOKEN")
BACKEND=${LINGCODE_BACKEND_ID:-}
if [ -z "$BACKEND" ]; then
  BACKEND=$(curl -sf "${auth[@]}" "$API/api/cloud/account/backends" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"][0]["backend_id"])')
fi
APPS_URL="$API/api/cloud/account/backends/$BACKEND/apps"
echo "backend=$BACKEND app=$APP_NAME"

extract_id() {
  python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
d = d.get("data", d) if isinstance(d, dict) else d
if isinstance(d, dict) and "app" in d:
    d = d["app"]
print((d.get("id") or d.get("app_id") or "") if isinstance(d, dict) else "")'
}

APP_ID=$(curl -s "${auth[@]}" "$APPS_URL" | APP_NAME="$APP_NAME" python3 -c '
import json, os, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
items = d.get("data", d) if isinstance(d, dict) else d
if isinstance(items, dict):
    items = items.get("apps", [])
for a in items or []:
    if isinstance(a, dict) and a.get("name") == os.environ["APP_NAME"]:
        print(a.get("id") or a.get("app_id") or ""); break')

if [ -z "$APP_ID" ]; then
  resp=$(curl -s -w $'\n%{http_code}' "${auth[@]}" -H 'Content-Type: application/json' -X POST "$APPS_URL" \
    -d "{\"name\":\"$APP_NAME\",\"runtime\":\"node\",\"runtimeVersion\":\"22\",\"healthcheckPath\":\"/health\"}")
  body=${resp%$'\n'*}; code=${resp##*$'\n'}
  if [ "$code" != "200" ] && [ "$code" != "201" ]; then
    echo "create app failed (HTTP $code): $body" >&2
    case "$body" in *hosted_app_quota_exceeded*|*quota_exceeded*)
      echo "Hosted apps are not included in the current LingCode plan. Upgrade at https://lingcode.dev/pricing.html and re-run." >&2 ;;
    esac
    exit 1
  fi
  APP_ID=$(extract_id <<<"$body")
  [ -n "$APP_ID" ] || { echo "could not read app id from: $body" >&2; exit 1; }
  echo "created app id=$APP_ID"
else
  echo "existing app id=$APP_ID"
fi

resp=$(curl -s -w $'\n%{http_code}' "${auth[@]}" -H 'Content-Type: application/gzip' \
  -X PUT "$APPS_URL/$APP_ID/source" --data-binary @"$BUNDLE")
body=${resp%$'\n'*}; code=${resp##*$'\n'}
if [ "$code" != "200" ] && [ "$code" != "201" ] && [ "$code" != "202" ]; then
  echo "source upload failed (HTTP $code): $body" >&2
  exit 1
fi
echo "$body"
echo "Deployed. Check: curl https://$APP_NAME.apps.lingcode.app/health?deps=1"
