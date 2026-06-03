#!/usr/bin/env bash
# Unit tests for install-hooks.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
INSTALL_HOOKS="$PLUGIN_DIR/scripts/install-hooks.sh"

FAILED=0
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

pass() { echo "  ✅ $1"; }
fail() { echo "  ❌ $1"; FAILED=1; }

# ─── Test 1: Fresh install (no existing settings.json) ───────────────────────
echo "=== Test 1: Fresh install ==="
PROJECT="$TMP_DIR/project1"
mkdir -p "$PROJECT"
bash "$INSTALL_HOOKS" "$PROJECT"

[ -f "$PROJECT/.claude/settings.json" ] \
  && pass "settings.json created" || fail "settings.json not created"
grep -q "post-edit-rule-check.sh" "$PROJECT/.claude/settings.json" \
  && pass "rule-check hook present in settings" || fail "rule-check hook missing"
grep -q "post-edit-test.sh" "$PROJECT/.claude/settings.json" \
  && pass "test hook present in settings" || fail "test hook missing"
[ -f "$PROJECT/.claude/scripts/post-edit-rule-check.sh" ] \
  && pass "rule-check script installed" || fail "rule-check script missing"
[ -f "$PROJECT/.claude/scripts/post-edit-test.sh" ] \
  && pass "test script installed" || fail "test script missing"
[ -x "$PROJECT/.claude/scripts/post-edit-rule-check.sh" ] \
  && pass "rule-check script is executable" || fail "rule-check script not executable"
[ -x "$PROJECT/.claude/scripts/post-edit-test.sh" ] \
  && pass "test script is executable" || fail "test script not executable"

# ─── Test 2: Idempotent (running twice doesn't duplicate hooks) ───────────────
echo ""
echo "=== Test 2: Idempotency ==="
bash "$INSTALL_HOOKS" "$PROJECT"
COUNT=$(grep -c "post-edit-rule-check.sh" "$PROJECT/.claude/settings.json" || true)
[ "$COUNT" -eq 1 ] \
  && pass "hook not duplicated (count=$COUNT)" || fail "hook duplicated (count=$COUNT)"

# ─── Test 3: Merge into existing settings.json (preserves other keys) ─────────
echo ""
echo "=== Test 3: Merge with existing settings.json ==="
PROJECT2="$TMP_DIR/project2"
mkdir -p "$PROJECT2/.claude"
cat > "$PROJECT2/.claude/settings.json" <<'EOF'
{
  "permissions": {
    "allow": ["Bash(git *)"]
  }
}
EOF
bash "$INSTALL_HOOKS" "$PROJECT2"
grep -q "post-edit-rule-check.sh" "$PROJECT2/.claude/settings.json" \
  && pass "hook merged into existing file" || fail "hook not merged"
grep -q '"allow"' "$PROJECT2/.claude/settings.json" \
  && pass "existing permissions preserved" || fail "existing permissions overwritten"
python3 -c "import json; json.load(open('$PROJECT2/.claude/settings.json'))" \
  && pass "merged file is valid JSON" || fail "merged file is invalid JSON"

# ─── Test 4: Merge idempotency on existing file ───────────────────────────────
echo ""
echo "=== Test 4: Merge idempotency on existing file ==="
bash "$INSTALL_HOOKS" "$PROJECT2"
COUNT2=$(grep -c "post-edit-rule-check.sh" "$PROJECT2/.claude/settings.json" || true)
[ "$COUNT2" -eq 1 ] \
  && pass "hook not duplicated on re-merge (count=$COUNT2)" \
  || fail "hook duplicated on re-merge (count=$COUNT2)"

# ─── Summary ─────────────────────────────────────────────────────────────────
echo ""
if [ "$FAILED" -eq 1 ]; then
  echo "❌ Tests FAILED"
  exit 1
else
  echo "✅ All tests passed"
fi
