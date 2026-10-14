#!/usr/bin/env bash
# theory-model-mutations.sh — 变异测试：证明机检确有牙齿（"错误模型必须被检出"）
#
# 做法：把 theory-model-check.mjs 复制到临时目录，逐个注入已知错误，要求每个变异体
#       **必须 FAIL（退出码 1）**，而基线必须 PASS（退出码 0）。不修改工作区任何文件。
#       锚点失配或变异体未生成都算 **测试工具失败**（exit 2），绝不计为"已检出"。
#
# 用法：bash theory-model-mutations.sh
set -u

SRC="$(cd "$(dirname "$0")" && pwd)/theory-model-check.mjs"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
DETECTED_ALL=1
TOOL_FAIL=0

mut() { # $1=旧片段 $2=新片段 $3=输出文件；锚点失配返回 3
  python3 - "$SRC" "$1" "$2" "$3" <<'PYEOF'
import sys
src, old, new, out = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
s = open(src, encoding='utf-8').read()
if old not in s:
    sys.stderr.write('ANCHOR NOT FOUND: %s\n' % old[:70])
    raise SystemExit(3)
open(out, 'w', encoding='utf-8').write(s.replace(old, new, 1))
PYEOF
}

case_run() { # $1=标签 $2=变异体文件
  if [ ! -s "$2" ]; then
    printf '  ERROR       %s  (变异体未生成)\n' "$1"
    TOOL_FAIL=1
    return
  fi
  rm -f "$TMP/out.txt"
  node "$2" >"$TMP/out.txt" 2>&1
  local code=$?
  local last
  last="$(tail -1 "$TMP/out.txt")"
  if [ "$code" -eq 0 ]; then
    printf '  UNDETECTED  %s  (exit=0, %s)\n' "$1" "$last"
    DETECTED_ALL=0
  else
    printf '  detected    %s  (exit=%s: %s)\n' "$1" "$code" "$last"
  fi
}

new_case() { # $1=标签 $2=旧片段 $3=新片段 $4=输出文件
  if ! mut "$2" "$3" "$4"; then
    printf '  ERROR       %s  (锚点失配，测试工具需修)\n' "$1"
    TOOL_FAIL=1
    return
  fi
  case_run "$1" "$4"
}

echo "theory-model-check 变异测试（每个变异体都必须被检出）"

cp "$SRC" "$TMP/base.mjs"
node "$TMP/base.mjs" >"$TMP/base.txt" 2>&1
BASE_CODE=$?
printf '  baseline    exit=%s  %s\n' "$BASE_CODE" "$(tail -1 "$TMP/base.txt")"
[ "$BASE_CODE" -eq 0 ] || { echo "FAIL: 基线本身不通过，变异测试无意义"; exit 1; }

new_case "M1 合法谓词丢掉隔离档+类型合取 (valid := noCycle)" \
  "return { valid: noCycle && isolationOk && typeOk, noCycle, isolationOk, typeOk }" \
  "return { valid: noCycle, noCycle, isolationOk, typeOk }" \
  "$TMP/m1.mjs"

new_case "M2 Kahn 的 acyclic 恒为 true" \
  "return { order: out, acyclic: out.length === ids.length }" \
  "return { order: out, acyclic: true }" \
  "$TMP/m2.mjs"

new_case "M3 判定优先链把 U/D 提到 A 之前" \
  "  if (states.includes('VERIFIED_ABSENT')) return 'skip'" \
  "  if (states.some((x) => x === 'UNDETECTABLE' || x === 'DECLARED_ONLY')) return 'inconclusive'" \
  "$TMP/m3.mjs"

new_case "M4 canon 退回键序敏感的 JSON.stringify" \
  "const contentHash = sha(stableCanon(p))" \
  "const contentHash = sha(JSON.stringify(p))" \
  "$TMP/m4.mjs"

new_case "M5 状态分区不交的断言改用共享存储（应被检出）" \
  "runStore(['a', 'b'], makePrivateStore()) === runStore(['b', 'a'], makePrivateStore())" \
  "runStore(['a', 'b'], makeSharedStore()) === runStore(['b', 'a'], makeSharedStore())" \
  "$TMP/m5.mjs"

new_case "M6 能力归一让声明覆盖客观探测" \
  "  if (probe === 'present') return 'VERIFIED_PRESENT'" \
  "  if (declared) return 'VERIFIED_PRESENT'" \
  "$TMP/m6.mjs"

new_case "M7 三色 DFS 对自环视而不见" \
  "      if (color.get(v) === 1) {" \
  "      if (color.get(v) === 1 && v !== u) {" \
  "$TMP/m7.mjs"

new_case "M8 节点取值丢掉入边排序（依赖入边列举顺序）" \
  ".map((e) => value.get(e.from))
      .sort()" \
  ".map((e) => value.get(e.from))" \
  "$TMP/m8.mjs"

new_case "M9 完整性检测丢掉长度守卫（多出外来条目被放过）" \
  "  if (seen.length !== R.length) return false // 缺条目或多出外来条目" \
  "  if (false) return false // 长度守卫被移除" \
  "$TMP/m9.mjs"

echo
if [ "$TOOL_FAIL" -eq 1 ]; then
  echo "TEST TOOL FAILURE — 有变异体未生成，结果不可信（exit 2）"
  exit 2
fi
if [ "$DETECTED_ALL" -eq 1 ]; then
  echo "ALL MUTANTS DETECTED — 机检对上述 9 个错误模型均有牙齿"
  exit 0
fi
echo "SOME MUTANTS SURVIVED — 存在无齿断言"
exit 1
