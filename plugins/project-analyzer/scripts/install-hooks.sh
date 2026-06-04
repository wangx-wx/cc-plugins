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
AGENTS_DIR="$CLAUDE_DIR/agents"
SKILLS_DIR="$CLAUDE_DIR/skills"
REFS_DIR="$CLAUDE_DIR/references"
SETTINGS="$CLAUDE_DIR/settings.json"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ─── 1. Install hook scripts ──────────────────────────────────────────────────
mkdir -p "$SCRIPTS_DIR"

cp "$SCRIPT_DIR/post-edit-rule-check.sh" "$SCRIPTS_DIR/post-edit-rule-check.sh"
cp "$SCRIPT_DIR/post-edit-test.sh"       "$SCRIPTS_DIR/post-edit-test.sh"
cp "$SCRIPT_DIR/stop-test-reminder.mjs"  "$SCRIPTS_DIR/stop-test-reminder.mjs"
chmod +x "$SCRIPTS_DIR/post-edit-rule-check.sh"
chmod +x "$SCRIPTS_DIR/post-edit-test.sh"

# ─── 1a. Install agent files ──────────────────────────────────────────────────
mkdir -p "$AGENTS_DIR"
cp "$PLUGIN_ROOT/references/testkit-gen.md" "$AGENTS_DIR/testkit-gen.md"

# ─── 1b. Install skill files ──────────────────────────────────────────────────
mkdir -p "$SKILLS_DIR/testkit-review"
cp "$PLUGIN_ROOT/references/testkit-review.md" "$SKILLS_DIR/testkit-review/testkit-review.md"

# ─── 1c. Install reference files ──────────────────────────────────────────────
mkdir -p "$REFS_DIR"
cp "$PLUGIN_ROOT/references/testing-rules.md" "$REFS_DIR/testing-rules.md"

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
    ],
    "Stop": [
      {
        "hooks": [
          {"type": "command", "command": "node .claude/scripts/stop-test-reminder.mjs", "timeout": 15}
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

cfg["hooks"].setdefault("Stop", [{"hooks": []}])
stop_entry = cfg["hooks"]["Stop"][0]
stop_entry.setdefault("hooks", [])
if not any(h.get("command", "").endswith("stop-test-reminder.mjs") for h in stop_entry["hooks"]):
    stop_entry["hooks"].append(
        {"type": "command", "command": "node .claude/scripts/stop-test-reminder.mjs", "timeout": 15}
    )

with open(path, "w") as f:
    json.dump(cfg, f, indent=2, ensure_ascii=False)
    f.write("\n")

print("✅ Merged hooks into existing .claude/settings.json")
PYEOF
