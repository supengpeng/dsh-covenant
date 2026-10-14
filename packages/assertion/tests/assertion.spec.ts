import { describe, expect, it } from 'vitest'
import {
  deepEqual,
  judge,
  normalizeCapability,
  VERDICTS,
  type CapabilityState,
  type Expected,
  type JudgeCtx,
  type Observation,
} from '../src/index.js'

function caps(entries: Record<string, CapabilityState>): JudgeCtx {
  return { capabilities: entries }
}

describe('verdict vocabulary', () => {
  it('covers exactly the five verdicts, no implicit pass', () => {
    expect([...VERDICTS].sort()).toEqual(['error', 'fail', 'inconclusive', 'pass', 'skip'])
    expect(new Set(VERDICTS).size).toBe(5)
  })
})

describe('η (normalizeCapability)', () => {
  it('maps the six probe×decl combinations onto exactly the four states', () => {
    expect(normalizeCapability('present', true)).toBe('present')
    expect(normalizeCapability('present', false)).toBe('present')
    expect(normalizeCapability('absent', true)).toBe('absent')
    expect(normalizeCapability('absent', false)).toBe('absent')
    expect(normalizeCapability('failed', false)).toBe('undetectable')
    expect(normalizeCapability('failed', true)).toBe('claimed-unverified')
  })
})

describe('judge (ρ priority chain)', () => {
  const present = caps({ cap: 'present' })

  it('is a pure function: same inputs → byte-identical record', () => {
    const a = judge({ value: 1 }, { expect: 1, require: ['cap'] }, present)
    const b = judge({ value: 1 }, { expect: 1, require: ['cap'] }, present)
    expect(a).toEqual(b)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('branch 1: observation error → error, regardless of capabilities', () => {
    const r = judge({ value: 1, error: true, errorDetail: 'boom' }, { expect: 1, require: [] }, present)
    expect(r.verdict).toBe('error')
    expect(r.evidence).toContain('boom')
  })

  it('A1 totality guard: a required capability missing from the matrix → explicit error, never a silent verdict', () => {
    const r = judge({ value: 1 }, { expect: 1, require: ['cap'] }, caps({}))
    expect(r.verdict).toBe('error')
    expect(r.evidence).toContain('cap')
  })

  it('branch 2: any required capability absent → skip', () => {
    const r = judge({ value: 1 }, { expect: 1, require: ['cap'] }, caps({ cap: 'absent' }))
    expect(r.verdict).toBe('skip')
  })

  it('branch 3: undetectable or claimed-unverified → inconclusive', () => {
    expect(judge({ value: 1 }, { expect: 1, require: ['cap'] }, caps({ cap: 'undetectable' })).verdict).toBe('inconclusive')
    expect(judge({ value: 1 }, { expect: 1, require: ['cap'] }, caps({ cap: 'claimed-unverified' })).verdict).toBe('inconclusive')
  })

  it('priority: absent wins over undetectable (definition 1.2 explanatory choice)', () => {
    const r = judge({ value: 1 }, { expect: 1, require: ['a', 'b'] }, caps({ a: 'absent', b: 'undetectable' }))
    expect(r.verdict).toBe('skip')
  })

  it('branch 4: all present → compare decides pass/fail', () => {
    expect(judge({ value: { x: 1 } }, { expect: { x: 1 }, require: ['cap'] }, present).verdict).toBe('pass')
    expect(judge({ value: { x: 2 } }, { expect: { x: 1 }, require: ['cap'] }, present).verdict).toBe('fail')
  })

  it('no required capabilities + no error → straight compare', () => {
    expect(judge({ value: 'ok' }, { expect: 'ok', require: [] }, caps({})).verdict).toBe('pass')
    expect(judge({ value: 'ok' }, { expect: 'no', require: [] }, caps({})).verdict).toBe('fail')
  })
})

describe('A10: evidence field is non-empty and locatable for every verdict', () => {
  const fixtures: Array<{ case: string; obs: Observation; exp: Expected; ctx: JudgeCtx }> = [
    { case: 'pass', obs: { value: 1 }, exp: { expect: 1, require: ['cap'] }, ctx: caps({ cap: 'present' }) },
    { case: 'fail', obs: { value: 2 }, exp: { expect: 1, require: ['cap'] }, ctx: caps({ cap: 'present' }) },
    { case: 'skip', obs: { value: 1 }, exp: { expect: 1, require: ['cap'] }, ctx: caps({ cap: 'absent' }) },
    { case: 'error', obs: { value: 1, error: true }, exp: { expect: 1, require: ['cap'] }, ctx: caps({ cap: 'present' }) },
    { case: 'inconclusive', obs: { value: 1 }, exp: { expect: 1, require: ['cap'] }, ctx: caps({ cap: 'undetectable' }) },
  ]
  for (const f of fixtures) {
    it(`${f.case}: evidence non-empty`, () => {
      const r = judge(f.obs, f.exp, f.ctx)
      expect(r.evidence.length).toBeGreaterThan(0)
      expect(r.channel.length).toBeGreaterThan(0)
      expect(r.verdict).toBe(f.case)
    })
  }
})

describe('T1: no false pass/fail when any required capability is non-present', () => {
  const nonPresent: CapabilityState[] = ['absent', 'undetectable', 'claimed-unverified']
  for (const state of nonPresent) {
    it(`required capability in state '${state}' never yields pass/fail`, () => {
      const r = judge({ value: 1 }, { expect: 1, require: ['cap'] }, caps({ cap: state }))
      expect(['pass', 'fail']).not.toContain(r.verdict)
    })
  }
})

describe('deepEqual (A1 determinism helpers)', () => {
  it('NaN equals NaN, +0 differs from -0', () => {
    expect(deepEqual(Number.NaN, Number.NaN)).toBe(true)
    expect(deepEqual(0, -0)).toBe(false)
  })
  it('object key order is irrelevant', () => {
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true)
  })
  it('array order is significant', () => {
    expect(deepEqual([1, 2], [2, 1])).toBe(false)
    expect(deepEqual([1, 2], [1, 2])).toBe(true)
  })
  it('nested structures compare deeply', () => {
    expect(deepEqual({ a: [1, { b: 'x' }] }, { a: [1, { b: 'x' }] })).toBe(true)
    expect(deepEqual({ a: [1, { b: 'x' }] }, { a: [1, { b: 'y' }] })).toBe(false)
  })
})