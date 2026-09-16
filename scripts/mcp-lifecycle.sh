#!/usr/bin/env bash
# Exercises the Streamable HTTP (spec 2025-11-25) session lifecycle against a running server with plain curl.
# Usage: scripts/mcp-lifecycle.sh [base-url]   (default http://127.0.0.1:3000)
set -euo pipefail

BASE="${1:-http://127.0.0.1:3000}"
ACCEPT='Accept: application/json, text/event-stream'
CT='Content-Type: application/json'
PV='Mcp-Protocol-Version: 2025-11-25'
INIT='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"lifecycle-check","version":"0.0.0"}}}'

fail() { echo "FAIL: $*" >&2; exit 1; }

echo "== POST initialize (expect 200 + Mcp-Session-Id)"
HDR=$(mktemp)
BODY=$(curl -sS -D "$HDR" -H "$ACCEPT" -H "$CT" -X POST "$BASE/mcp" --data "$INIT")
CODE=$(head -1 "$HDR" | awk '{print $2}')
SID=$(grep -i '^mcp-session-id:' "$HDR" | tr -d '\r' | awk '{print $2}')
echo "status=$CODE session=$SID"
echo "$BODY" | head -c 300; echo
[ "$CODE" = "200" ] && [ -n "$SID" ] || fail "initialize"

echo "== POST notifications/initialized (expect 202)"
CODE=$(curl -sS -o /dev/null -w '%{http_code}' -H "$ACCEPT" -H "$CT" -H "$PV" -H "Mcp-Session-Id: $SID" -X POST "$BASE/mcp" \
  --data '{"jsonrpc":"2.0","method":"notifications/initialized"}')
echo "status=$CODE"; [ "$CODE" = "202" ] || fail "initialized notification"

echo "== POST tools/list (expect 200 application/json)"
RESP=$(curl -sS -w '\n%{http_code} %{content_type}' -H "$ACCEPT" -H "$CT" -H "$PV" -H "Mcp-Session-Id: $SID" -X POST "$BASE/mcp" \
  --data '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')
echo "$RESP" | tail -1
echo "$RESP" | head -1 | head -c 400; echo
echo "$RESP" | tail -1 | grep -q '^200' || fail "tools/list"

echo "== POST tools/call ping (expect 200)"
RESP=$(curl -sS -w '\n%{http_code}' -H "$ACCEPT" -H "$CT" -H "$PV" -H "Mcp-Session-Id: $SID" -X POST "$BASE/mcp" \
  --data '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"ping","arguments":{}}}')
echo "$RESP" | head -1 | head -c 300; echo
echo "$RESP" | tail -1 | grep -q '^200' || fail "tools/call ping"

echo "== GET standalone stream (expect 200 text/event-stream, NOT 405)"
CODE=$(curl -sS -o /dev/null -w '%{http_code} %{content_type}' --max-time 2 -H 'Accept: text/event-stream' -H "$PV" -H "Mcp-Session-Id: $SID" "$BASE/mcp" || true)
echo "status=$CODE"; echo "$CODE" | grep -q '^200' || fail "GET stream"

echo "== DELETE session (expect 2xx)"
CODE=$(curl -sS -o /dev/null -w '%{http_code}' -H "$PV" -H "Mcp-Session-Id: $SID" -X DELETE "$BASE/mcp")
echo "status=$CODE"; [[ "$CODE" == 2* ]] || fail "DELETE"

echo "== reuse the dead session (expect 404 / -32001)"
CODE=$(curl -sS -o /dev/null -w '%{http_code}' -H "$ACCEPT" -H "$CT" -H "$PV" -H "Mcp-Session-Id: $SID" -X POST "$BASE/mcp" \
  --data '{"jsonrpc":"2.0","id":4,"method":"tools/list"}')
echo "status=$CODE"; [ "$CODE" = "404" ] || fail "dead session"

echo "== POST without a session (expect 400 / -32000)"
CODE=$(curl -sS -o /dev/null -w '%{http_code}' -H "$ACCEPT" -H "$CT" -X POST "$BASE/mcp" \
  --data '{"jsonrpc":"2.0","id":5,"method":"tools/list"}')
echo "status=$CODE"; [ "$CODE" = "400" ] || fail "no session"

echo "== OPTIONS preflight (expect Access-Control-Expose-Headers incl. Mcp-Session-Id)"
curl -sS -D - -o /dev/null -X OPTIONS -H 'Origin: http://localhost:8080' -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type,mcp-session-id,mcp-protocol-version' "$BASE/mcp" | grep -i 'access-control' || true

rm -f "$HDR"
echo "ALL LIFECYCLE CHECKS PASSED against $BASE"
