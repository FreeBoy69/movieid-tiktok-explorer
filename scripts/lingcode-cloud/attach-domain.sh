#!/usr/bin/env bash
# Attach autoyt.cc to the AutoYT hosted app, then verify the edge + OAuth loop.
#
# Needs a token with EDITOR on the backend. Uses $LINGCODE_TOKEN if set,
# otherwise falls back to the one in .mcp.json.
#
#   LINGCODE_TOKEN=lc_xxx scripts/lingcode-cloud/attach-domain.sh
#
# Do NOT change DNS. autoyt.cc -> 138.197.107.228 is LingCode's on-demand-TLS
# edge and is already correct. In Cloudflare it must stay DNS-only (grey
# cloud); the orange-cloud proxy breaks on-demand TLS issuance.
set -uo pipefail
cd "$(dirname "$0")/../.."

API=https://lingcode.dev/api/cloud/account
BACKEND=32f0868d386a15ec19705ef0
APP=happ-41f124436115bb2dc719d991
DOMAIN=${1:-autoyt.cc}

TOKEN=${LINGCODE_TOKEN:-}
if [ -z "$TOKEN" ] && [ -f .mcp.json ]; then
  TOKEN=$(python3 -c "import json;print(json.load(open('.mcp.json'))['mcpServers']['lingcode-cloud']['env']['LINGCODE_TOKEN'])" 2>/dev/null || true)
fi
[ -n "$TOKEN" ] || { echo "No token. Set LINGCODE_TOKEN." >&2; exit 1; }

auth=(-H "Authorization: Bearer $TOKEN")
APPS="$API/backends/$BACKEND/apps/$APP"

# Fail fast and clearly on a stale token rather than mid-attach.
code=$(curl -s -m 15 -o /dev/null -w '%{http_code}' "${auth[@]}" "$API/backends")
if [ "$code" = "401" ]; then
  echo "Token is stale (401). Refresh it in .mcp.json or export LINGCODE_TOKEN." >&2
  exit 1
fi

echo "== attaching $DOMAIN =="
resp=$(curl -s -m 30 -w $'\n%{http_code}' "${auth[@]}" -H 'content-type: application/json' \
  -X POST -d "{\"domain\":\"$DOMAIN\"}" "$APPS/domains")
body=${resp%$'\n'*}; http=${resp##*$'\n'}
echo "HTTP $http: $body"
case "$http" in
  200|201) ;;
  409)
    # 409 does NOT mean "already ours". domain_taken means the domain is bound
    # to some OTHER resource, so verification below would poll a 404 forever.
    # Only continue when this app actually owns it.
    if curl -s -m 20 "${auth[@]}" "$APPS/domains" | grep -q "\"$DOMAIN\""; then
      echo "(already attached to this app -- continuing to verification)"
    else
      echo "domain is attached to a DIFFERENT resource; this app's domain list does not contain it." >&2
      echo "Release it from the resource that holds it, then re-run." >&2
      exit 1
    fi ;;
  *) echo "attach failed" >&2; exit 1 ;;
esac

echo
echo "== attached domains =="
curl -s -m 20 "${auth[@]}" "$APPS/domains"; echo

# First request triggers Let's Encrypt issuance, so the initial curl can be slow
# or fail the handshake. Retry before calling it broken.
echo
echo "== edge check (cert issues on first request) =="
for i in $(seq 1 10); do
  out=$(curl -sS -m 30 -o /tmp/dom-body.txt -w '%{http_code}' "https://$DOMAIN/" 2>/tmp/dom-err.txt)
  rc=$?
  if [ $rc -ne 0 ]; then
    echo "  t+$((i*10))s  curl error: $(tr -d '\n' < /tmp/dom-err.txt | head -c 120)"
  elif grep -q "No route for" /tmp/dom-body.txt 2>/dev/null; then
    echo "  t+$((i*10))s  HTTP $out  edge fallback 404 -- mapping not live yet"
  else
    echo "  t+$((i*10))s  HTTP $out  serving app content"
    break
  fi
  sleep 10
done

echo
echo "== the real check: OAuth callback =="
printf '  /api/auth/session          -> '; curl -s -m 25 -o /dev/null -w '%{http_code}\n' "https://$DOMAIN/api/auth/session"
printf '  /api/auth/google           -> '; curl -s -m 25 -o /dev/null -w '%{http_code}\n' "https://$DOMAIN/api/auth/google"
printf '  /api/auth/google/callback  -> '; curl -s -m 25 -o /dev/null -w '%{http_code}\n' "https://$DOMAIN/api/auth/google/callback"
echo
echo "200/302 on session+google means the loop is closed. A 404 with"
echo "\"No route for\" means the attach did not land -- check:"
echo "  curl -s -H 'Authorization: Bearer \$T' $APPS/domains"
echo "  curl -s -H 'Authorization: Bearer \$T' $APPS/deploys/latest"
