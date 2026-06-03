#!/usr/bin/env bash
# Lint prompt files in project-analyzer plugin.
# Checks: fence pairing, required agent files, path contract.

set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENTS_DIR="$PLUGIN_DIR/agents"
SKILLS_DIR="$PLUGIN_DIR/skills"
COMMANDS_DIR="$PLUGIN_DIR/commands"

FAILED=0

# ─── Check 1: Required agent files exist ──────────────────────────────────────
echo "=== Check 1: Required agent files ==="
REQUIRED_AGENTS="scanner.md analyzer.md rule-writer.md rule-checker.md test-generator.md"
for f in $REQUIRED_AGENTS; do
  if [ ! -f "$AGENTS_DIR/$f" ]; then
    echo "❌ Required agent missing: agents/$f"
    FAILED=1
  fi
done
[ "$FAILED" -eq 0 ] && echo "✅ All required agents present"

# ─── Check 2: Markdown fence pairing ────────────────────────────────────────
echo ""
echo "=== Check 2: Markdown fence pairing ==="
FENCE_FAIL=0
while IFS= read -r -d '' file; do
  count=$(grep -c '^```' "$file" 2>/dev/null || true)
  if [ $(( count % 2 )) -ne 0 ]; then
    echo "❌ Unbalanced fences in $(basename "$file") (count=$count): $file"
    FENCE_FAIL=1
    FAILED=1
  fi
done < <(find "$AGENTS_DIR" "$COMMANDS_DIR" "$SKILLS_DIR" -name "*.md" -print0)
[ "$FENCE_FAIL" -eq 0 ] && echo "✅ All fences balanced"

# ─── Check 3: Path contract (.rules/ without .claude prefix) ─────────────────
echo ""
echo "=== Check 3: Path contract (no bare .rules/ allowed) ==="
BAD=$(grep -rn '\.rules/' \
  "$AGENTS_DIR" "$COMMANDS_DIR" "$SKILLS_DIR" \
  --include="*.md" 2>/dev/null \
  | grep -v '\.claude/rules/' || true)
if [ -n "$BAD" ]; then
  echo "❌ Non-standard path refs found (use .claude/rules/ not .rules/):"
  echo "$BAD"
  FAILED=1
else
  echo "✅ All paths use .claude/rules/"
fi

# ─── Check 4: No stale agent references ──────────────────────────────────────
echo ""
echo "=== Check 4: No stale agent names ==="
STALE=$(grep -rn "arch-analyst\|api-analyst\|security-analyst\|robustness-analyst\|db-analyst\|cache-analyst\|mq-analyst\|testing-analyst\|deep-analyst" \
  "$AGENTS_DIR" "$COMMANDS_DIR" "$SKILLS_DIR" \
  --include="*.md" 2>/dev/null || true)
if [ -n "$STALE" ]; then
  echo "❌ Stale agent references found (old 8-analyst pattern):"
  echo "$STALE"
  FAILED=1
else
  echo "✅ No stale agent references"
fi

# ─── Summary ─────────────────────────────────────────────────────────────────
echo ""
if [ "$FAILED" -eq 1 ]; then
  echo "❌ Lint FAILED — fix the issues above before merging."
  exit 1
else
  echo "✅ All checks passed."
fi
