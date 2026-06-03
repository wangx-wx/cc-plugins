#!/usr/bin/env bash
# H2 / Stop 软提醒：本轮若改了 src/main 的 .java 但缺对应测试，提示（不阻断，仅 systemMessage）。
# 规范见 plugin 内 references/testing-rules.md。判断故意做"粗"，精确分层判断交给 /test-review。
input=$(cat)  # Stop hook stdin（此处不强依赖其字段，靠 git 看改动）

changed=$( { git diff --name-only HEAD 2>/dev/null; git diff --cached --name-only 2>/dev/null; } \
  | sort -u | grep -E 'src/main/java/.*\.java$' || true )
[ -z "$changed" ] && exit 0

missing=""
while IFS= read -r f; do
  [ -z "$f" ] && continue
  base=$(basename "$f" .java)
  # 豁免无逻辑类型（规范 §1）
  case "$base" in
    *DTO|*VO|*Entity|*Config|*Constant|*Constants|*Enum|*Properties) continue ;;
  esac
  # 粗判断：test 目录里有没有同名 <base>Test / <base>IT（不深究包路径）
  if ! find . -path '*/src/test/java/*' \( -name "${base}Test.java" -o -name "${base}IT.java" \) 2>/dev/null | grep -q .; then
    missing="${missing}
  - ${f}  (缺 ${base}Test / ${base}IT)"
  fi
done <<< "$changed"

[ -z "$missing" ] && exit 0

msg="测试提醒（仅提示，不阻断）：以下 src/main 改动疑似缺对应测试，请按团队规范确认是否需补，或运行 /test-review 精确判断：${missing}"
printf '%s' "$msg" | python3 -c 'import json,sys; print(json.dumps({"systemMessage": sys.stdin.read()}))'
exit 0
