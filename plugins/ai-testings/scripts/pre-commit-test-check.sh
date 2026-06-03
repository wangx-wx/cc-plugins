#!/usr/bin/env bash
# H4 / PreToolUse(Bash) 软提醒：仅当命令是 git commit 时，检查暂存的 src/main 改动缺测试则提示（不阻断）。
# 规范见 plugin 内 references/testing-rules.md。判断故意做"粗"，精确分层判断交给 /test-review。
input=$(cat)
cmd=$(printf '%s' "$input" | python3 -c 'import json,sys
try:
    print(json.load(sys.stdin).get("tool_input",{}).get("command",""))
except Exception:
    print("")' 2>/dev/null)

# 只在 git commit 时介入，其余命令直接放行
case "$cmd" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac

staged=$(git diff --cached --name-only 2>/dev/null | grep -E 'src/main/java/.*\.java$' || true)
[ -z "$staged" ] && exit 0

missing=""
while IFS= read -r f; do
  [ -z "$f" ] && continue
  base=$(basename "$f" .java)
  case "$base" in
    *DTO|*VO|*Entity|*Config|*Constant|*Constants|*Enum|*Properties) continue ;;
  esac
  if ! find . -path '*/src/test/java/*' \( -name "${base}Test.java" -o -name "${base}IT.java" \) 2>/dev/null | grep -q .; then
    missing="${missing}
  - ${f}"
  fi
done <<< "$staged"

[ -z "$missing" ] && exit 0

msg="提交前测试提醒（不阻断）：本次暂存的 src/main 改动疑似缺对应测试：${missing}
按团队规范确认是否需补（/test-review 精确判断）。"
printf '%s' "$msg" | python3 -c 'import json,sys; print(json.dumps({"systemMessage": sys.stdin.read()}))'
exit 0
