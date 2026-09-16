#!/usr/bin/env bash
# Installs the CareCompanion skill into an Agent Skills directory and (optionally) registers the MCP server.
# Usage: skills/carecompanion/scripts/install.sh [mcp-url]
#   SKILLS_DIR  target skills directory (default: ~/.claude/skills)
#   MCP_JSON    .mcp.json to merge the server into (default: ./.mcp.json in the current directory, if present)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILLS_DIR="${SKILLS_DIR:-$HOME/.claude/skills}"
TARGET="$SKILLS_DIR/carecompanion"
MCP_URL="${1:-http://127.0.0.1:3000/mcp}"
MCP_JSON="${MCP_JSON:-./.mcp.json}"

mkdir -p "$TARGET"
cp -R "$HERE/SKILL.md" "$HERE/references" "$TARGET/"
echo "installed skill → $TARGET"

if [ -f "$MCP_JSON" ] || [ -n "${MCP_JSON_CREATE:-}" ]; then
  node - "$MCP_JSON" "$MCP_URL" <<'EOF'
const fs = require('node:fs');
const [file, url] = process.argv.slice(2);
let json = {};
try { json = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
json.mcpServers = json.mcpServers || {};
json.mcpServers.carecompanion = { type: 'http', url };
fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
console.log(`registered carecompanion (${url}) in ${file}`);
EOF
fi

if command -v npx >/dev/null 2>&1; then
  npx -y skills-ref validate "$TARGET" 2>/dev/null && echo "skill validated" || echo "(skills-ref validator not available or reported issues; see above)"
fi
