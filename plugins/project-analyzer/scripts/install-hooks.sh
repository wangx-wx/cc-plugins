#!/usr/bin/env bash
# Installs project-analyzer PostToolUse hooks into target project's
# .claude/settings.json and copies hook scripts to .claude/scripts/.
#
# Usage: install-hooks.sh <project_path>

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_PATH="${1:?Usage: install-hooks.sh <project_path>}"
CLAUDE_DIR="$PROJECT_PATH/.claude"
SCRIPTS_DIR="$CLAUDE_DIR/scripts"
SETTINGS="$CLAUDE_DIR/settings.json"

# ─── 1. Install hook scripts ──────────────────────────────────────────────────
mkdir -p "$SCRIPTS_DIR"

cp "$SCRIPT_DIR/post-edit-rule-check.sh" "$SCRIPTS_DIR/post-edit-rule-check.sh"
cp "$SCRIPT_DIR/post-edit-test.sh"       "$SCRIPTS_DIR/post-edit-test.sh"
chmod +x "$SCRIPTS_DIR/post-edit-rule-check.sh"
chmod +x "$SCRIPTS_DIR/post-edit-test.sh"

# ─── 2. Write or merge settings.json ─────────────────────────────────────────
if [ ! -f "$SETTINGS" ]; then
  mkdir -p "$CLAUDE_DIR"
  cat > "$SETTINGS" <<'EOF'
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {"type": "command", "command": "bash .claude/scripts/post-edit-rule-check.sh"},
          {"type": "command", "command": "bash .claude/scripts/post-edit-test.sh"}
        ]
      }
    ]
  }
}
EOF
  echo "✅ Created .claude/settings.json with hook configuration"
  exit 0
fi

# File exists — idempotency check
if grep -q "post-edit-rule-check.sh" "$SETTINGS" 2>/dev/null; then
  echo "✅ Hooks already installed (skipping)"
  exit 0
fi

# Merge into existing settings.json
python3 - "$SETTINGS" <<'PYEOF'
import json, sys

path = sys.argv[1]
with open(path) as f:
    cfg = json.load(f)

new_entry = {
    "matcher": "Edit|Write",
    "hooks": [
        {"type": "command", "command": "bash .claude/scripts/post-edit-rule-check.sh"},
        {"type": "command", "command": "bash .claude/scripts/post-edit-test.sh"}
    ]
}

cfg.setdefault("hooks", {})
cfg["hooks"].setdefault("PostToolUse", [])
cfg["hooks"]["PostToolUse"].append(new_entry)

with open(path, "w") as f:
    json.dump(cfg, f, indent=2, ensure_ascii=False)
    f.write("\n")

print("✅ Merged hooks into existing .claude/settings.json")
PYEOF
