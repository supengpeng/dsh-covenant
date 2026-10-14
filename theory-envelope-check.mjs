#!/usr/bin/env node
// theory-envelope-check.mjs —— 信封层机械校验
//
// 机检的是「文档信封层」（版本号 / 文件哈希 / 外部引用 / 引用文件是否存在），
// 这些恰好是 model-check 不覆盖、而历史上反复出错（F18/F19/F20、mutations.sh 哈希）的一层。
//
// 断言四件事（全部纯机械，无 oracle）：
//   1. theory-proof.md 里每个「[file](file)+ sha256 `...`」引用的文件都存在且哈希一致；
//   2. 状态行「第 N 版」== 附录 C 标题上界「第 N 版」== 最新处置列头「第 N 版」；
//   3. 证明对象 architecture.md 的 sha256 可复算且与声明一致（由断言 1 覆盖）；
//   4. 附录 A 引用的每个 §n ／ §n.m 在 architecture.md 中真实存在（## / ### 标题）。
//
// 复现：node theory-envelope-check.mjs（无网络、无时间依赖）
// 退出码：0 = 全部通过；1 = 有信封层断裂。

import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const THEORY = 'theory-proof.md';
const ARCH = 'architecture.md';

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

const tp = readFileSync(THEORY, 'utf8');
const tpLines = tp.split('\n');
let failures = 0;
const fail = (msg) => { console.error('FAIL  ' + msg); failures++; };
const ok = (msg) => console.log('OK    ' + msg);

// ---------- 断言 1 + 3：所有「自引用文件名 + sha256」的外部文件存在且哈希一致 ----------
console.log('== 断言 1/3：文件存在 + sha256 一致 ==');
const declared = []; // {file, hash, line}
for (let i = 0; i < tpLines.length; i++) {
  const line = tpLines[i];
  const links = [...line.matchAll(/\[([^\]\[]+)\]\(([^()]+)\)/g)]
    .map((m) => ({ text: m[1].trim(), href: m[2].trim() }))
    .filter((l) => l.text === l.href);
  const hashes = [...line.matchAll(/sha256 `([0-9a-f]{64})`/g)].map((m) => m[1]);
  if (links.length && hashes.length) {
    if (links.length !== hashes.length) {
      fail(`${THEORY}:${i + 1} 有 ${links.length} 个文件链接但 ${hashes.length} 个 sha256`);
      continue;
    }
    links.forEach((l, k) => declared.push({ file: l.href, hash: hashes[k], line: i + 1 }));
  }
}
if (declared.length === 0) fail(`未解析到任何 sha256 声明`);
const seen = new Set();
for (const { file, hash, line } of declared) {
  if (seen.has(file)) continue; // 同一文件多次声明以最后一次为准，避免重复报
  seen.add(file);
  if (!existsSync(file)) { fail(`${THEORY}:${line} 引用文件不存在：${file}`); continue; }
  const actual = sha256(file);
  if (actual !== hash) {
    fail(`${THEORY}:${line} ${file} 哈希不符：声明 ${hash.slice(0, 12)}… 实际 ${actual.slice(0, 12)}…`);
  } else {
    ok(`${file} = ${hash.slice(0, 12)}…`);
  }
}

// ---------- 断言 2：版本信封一致（状态行 = 附录C标题上界 = 最新处置列头） ----------
console.log('== 断言 2：版本信封一致 ==');
const statusLine = tpLines.find((x) => x.startsWith('- 状态：'));
const statusV = statusLine ? Number(statusLine.match(/第\s*([0-9]+)\s*版/)?.[1]) : null;
const appTitleLine = tpLines.find((x) => x.includes('附录 C') && x.includes('第 1 版 → 第'));
const appV = appTitleLine ? Number(appTitleLine.match(/第 1 版 → 第\s*([0-9]+)\s*版/)?.[1]) : null;
const disposalVs = tpLines
  .filter((x) => /处置（第\s*[0-9]+\s*版）/.test(x))
  .map((x) => Number(x.match(/处置（第\s*([0-9]+)\s*版）/)[1]));
const maxDisposal = disposalVs.length ? Math.max(...disposalVs) : null;
if (statusV === null) fail('未能解析状态行版本号');
if (appV === null) fail('未能解析附录 C 标题上界版本号');
if (maxDisposal === null) fail('未能解析任何「处置（第 N 版）」列头');
if (statusV !== null && appV !== null && maxDisposal !== null) {
  if (!(statusV === appV && appV === maxDisposal)) {
    fail(`版本信封不一致：状态=第${statusV}版 附录C标题上界=第${appV}版 最新处置列头=第${maxDisposal}版`);
  } else {
    ok(`一致：第 ${statusV} 版（状态行 / 附录C标题 / 最新处置列头）`);
  }
}

// ---------- 断言 4：附录 A 引用的 §n / §n.m 在 architecture.md 中都存在 ----------
console.log('== 断言 4：附录 A 的 §n.m 引用真实存在 ==');
const arch = readFileSync(ARCH, 'utf8');
const archHeadings = new Set(
  [...arch.matchAll(/^#{2,3}\s+(\d+(?:\.\d+)?)/gm)].map((m) => m[1])
);
const aStart = tpLines.findIndex((x) => x.startsWith('## 附录 A'));
const bStart = tpLines.findIndex((x) => x.startsWith('## 附录 B'));
if (aStart < 0) { fail('未找到「## 附录 A」'); }
else {
  const appendixA = tpLines.slice(aStart, bStart < 0 ? tpLines.length : bStart).join('\n');
  const refs = [...appendixA.matchAll(/§(\d+)(?:\.(\d+))?/g)];
  const missing = new Set();
  for (const m of refs) {
    const key = m[2] ? `${m[1]}.${m[2]}` : m[1];
    if (!archHeadings.has(key)) missing.add(`§${key}`);
  }
  if (missing.size) fail(`附录 A 引用了 architecture.md 中不存在的章节：${[...missing].join('、')}`);
  else ok('附录 A 所有 §n / §n.m 引用均存在');
}

console.log(`\n${failures === 0 ? '✅ 信封层全通过' : `❌ ${failures} 处信封层断裂`}`);
process.exit(failures === 0 ? 0 : 1);