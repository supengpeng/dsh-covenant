import type { EvidenceChain, Face } from './chain.js'

/**
 * 三种真相面孔（纯函数——由权威链派生，禁止反写，§15.3 单向性）。
 * 同一条链 → 同一字符串；重算与已发面孔 byte 一致。
 */
export function renderFace(chain: EvidenceChain, face: Face): string {
  switch (face) {
    case 'tap':
      return renderTap(chain)
    case 'junit':
      return renderJunit(chain)
    case 'html':
      return renderHtml(chain)
  }
}

function renderTap(chain: EvidenceChain): string {
  const lines = ['TAP version 13', `1..${chain.entries.length}`]
  chain.entries.forEach((e, i) => {
    const n = i + 1
    switch (e.payload.verdict) {
      case 'pass':
        lines.push(`ok ${n} - ${e.channel}`)
        break
      case 'fail':
        lines.push(`not ok ${n} - ${e.channel}`)
        lines.push(`  # ${escapeTap(e.evidence)}`)
        break
      case 'error':
        lines.push(`not ok ${n} - ${e.channel}`)
        lines.push(`  # ${escapeTap(e.evidence)}`)
        break
      case 'skip':
        lines.push(`ok ${n} - ${e.channel} # SKIP ${escapeTap(e.evidence)}`)
        break
      case 'inconclusive':
        lines.push(`ok ${n} - ${e.channel} # SKIP (inconclusive) ${escapeTap(e.evidence)}`)
        break
    }
  })
  return lines.join('\n') + '\n'
}

function renderJunit(chain: EvidenceChain): string {
  const s = chain.summary()
  const cases = chain.entries
    .map((e, i) => {
      const name = `${i + 1}-${e.channel}`
      const children: string[] = []
      if (e.payload.verdict === 'fail') children.push(`    <failure message="${escapeXml(e.evidence)}"/>`)
      if (e.payload.verdict === 'error') children.push(`    <error message="${escapeXml(e.evidence)}"/>`)
      if (e.payload.verdict === 'skip' || e.payload.verdict === 'inconclusive') {
        children.push(`    <skipped message="${escapeXml(e.evidence)}"/>`)
      }
      children.push(`    <system-out>${escapeXml(e.evidence)}</system-out>`)
      const body = children.length ? `\n${children.join('\n')}\n  ` : ''
      return `  <testcase classname="dsh-covenant" name="${escapeXml(name)}">${body}</testcase>`
    })
    .join('\n')
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuite name="dsh-covenant" tests="${chain.entries.length}" failures="${s.fail}" errors="${s.error}" skipped="${s.skip + s.inconclusive}">`,
    cases,
    '</testsuite>',
  ].join('\n') + '\n'
}

function renderHtml(chain: EvidenceChain): string {
  const s = chain.summary()
  const rows = chain.entries
    .map((e, i) => {
      return `      <tr class="verdict-${e.payload.verdict}"><td>${i + 1}</td><td>${escapeHtml(e.channel)}</td><td>${escapeHtml(e.payload.verdict)}</td><td>${escapeHtml(e.evidence)}</td></tr>`
    })
    .join('\n')
  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8"><title>dsh-covenant report</title></head>',
    '<body>',
    `  <h1>dsh-covenant report</h1>`,
    `  <p>root <code>${escapeHtml(chain.root())}</code> · pass ${s.pass} · fail ${s.fail} · skip ${s.skip} · error ${s.error} · inconclusive ${s.inconclusive}</p>`,
    '  <table><thead><tr><th>#</th><th>channel</th><th>verdict</th><th>evidence</th></tr></thead><tbody>',
    rows,
    '  </tbody></table>',
    '</body></html>',
  ].join('\n') + '\n'
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeTap(s: string): string {
  return s.replace(/\n/g, '\\n')
}