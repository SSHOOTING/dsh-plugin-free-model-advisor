import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_MODELS,
  analyze,
  classify,
  formatReport,
  normalizeModels,
  recommend,
  redact,
} from '../lib/core.js'

test('default catalog contains only the two allowed free models', () => {
  assert.equal(DEFAULT_MODELS.length, 2)
  assert.deepEqual(
    DEFAULT_MODELS.map((m) => [m.provider, m.id, m.contextWindow, m.free]),
    [
      ['opencode-go', 'hy4-flash-free', 1048576, true],
      ['opencode-go', 'longcat-2.5-free', 1000000, true],
    ],
  )
  assert.deepEqual(normalizeModels(undefined), [
    { id: 'hy4-flash-free', provider: 'opencode-go', contextWindow: 1048576, status: 'free' },
    { id: 'longcat-2.5-free', provider: 'opencode-go', contextWindow: 1000000, status: 'free' },
  ])
})

test('classify only marks explicit free or opencode-go *-free ids as free', () => {
  assert.equal(classify({ id: 'anything', free: true }), 'free')
  assert.equal(classify({ id: 'anything-free' }), 'free')
  assert.equal(classify({ id: 'longcat-2.5-free', provider: 'opencode-go' }), 'free')
  assert.equal(classify({ id: 'longcat-2.5-free', provider: 'other-provider' }), 'unknown')
  assert.equal(classify({ id: 'hy4-flash', provider: 'opencode-go' }), 'unknown')
  assert.equal(classify({ id: 'hy4-flash-free', free: false }), 'free')
  assert.equal(classify({ id: 'free' }), 'unknown')
  assert.equal(classify({ id: 'x', free: 'true' }), 'unknown')
  assert.equal(classify(null), 'unknown')
  assert.equal(classify('nope'), 'unknown')
})

test('normalizeModels keeps only known fields from a list', () => {
  const rows = normalizeModels([
    {
      id: 'hy4-flash-free',
      provider: 'opencode-go',
      contextWindow: 1048576,
      maxTokens: 8192,
      free: true,
      secret: 'LEAK_SECRET',
      api_key: 'LEAK_KEY',
    },
    { id: 'pro', provider: 'opencode-go', password: 'LEAK_PASSWORD' },
    { id: 42 },
    null,
    'junk',
  ])
  assert.deepEqual(rows, [
    {
      id: 'hy4-flash-free',
      provider: 'opencode-go',
      contextWindow: 1048576,
      maxTokens: 8192,
      status: 'free',
    },
    { id: 'pro', provider: 'opencode-go', status: 'unknown' },
  ])
  assert.ok(!JSON.stringify(rows).includes('LEAK_'))
})

test('normalizeModels accepts a map keyed by id or provider/id', () => {
  const rows = normalizeModels({
    'opencode-go/hy4-flash-free': { contextWindow: 1048576 },
    'standalone-free': { free: true },
    junk: 'not-an-object',
    __proto__: { id: 'polluted', free: true },
  })
  assert.deepEqual(rows, [
    { id: 'hy4-flash-free', provider: 'opencode-go', contextWindow: 1048576, status: 'free' },
    { id: 'standalone-free', status: 'free' },
  ])
})

test('malformed or empty config falls back to the default catalog', () => {
  const expected = normalizeModels(undefined)
  for (const bad of [undefined, null, 42, 'nope', {}, [], [{ nope: 1 }], { models: 1 }]) {
    assert.deepEqual(normalizeModels(bad), expected, `input: ${String(bad)}`)
  }
})

test('hostile config never throws and falls back to defaults', () => {
  const throwing = new Proxy(
    {},
    {
      get() { throw new Error('boom') },
      ownKeys() { throw new Error('boom') },
    },
  )
  const getterBomb = {}
  Object.defineProperty(getterBomb, 'id', { enumerable: true, get() { throw new Error('boom') } })
  assert.doesNotThrow(() => normalizeModels(throwing))
  assert.deepEqual(normalizeModels(throwing), normalizeModels(undefined))
  assert.doesNotThrow(() => normalizeModels([getterBomb]))
  assert.doesNotThrow(() => classify(throwing))
  assert.doesNotThrow(() => analyze(throwing))
  assert.equal(classify(throwing), 'unknown')
})

test('recommend prefers hy4-flash-free, then another free model, never unknown', () => {
  const rows = normalizeModels([
    { id: 'longcat-2.5-free' },
    { id: 'hy4-flash-free' },
    { id: 'pro' },
  ])
  assert.equal(recommend(rows).id, 'hy4-flash-free')

  const withoutHy = normalizeModels([{ id: 'aaa-free' }, { id: 'bbb-free' }])
  assert.equal(recommend(withoutHy).id, 'aaa-free')
  assert.equal(recommend(normalizeModels([{ id: 'pro' }])), null)
})

test('formatReport lists FREE/UNKNOWN, a recommended default, a hint, and redacts', () => {
  const analysis = analyze([
    { id: 'hy4-flash-free', provider: 'opencode-go', contextWindow: 1048576 },
    { id: 'pro-token=abc123', provider: 'opencode-go' },
  ])
  const text = formatReport(analysis)
  assert.match(text, /1\/2 configured models are FREE/)
  assert.match(text, /opencode-go\/hy4-flash-free/)
  assert.match(text, /\bUNKNOWN\b/)
  assert.match(text, /Recommended default: opencode-go\/hy4-flash-free/)
  assert.match(text, /Hint:/)
  assert.doesNotMatch(text, /abc123/)
})

test('formatReport --json emits only known fields and redacts strings', () => {
  const analysis = analyze([
    {
      id: 'hy4-flash-free',
      provider: 'opencode-go',
      contextWindow: 1048576,
      maxTokens: 8192,
      secret: 'LEAK_SECRET_VALUE_123',
      password: 'LEAK_PASSWORD_VALUE_456',
    },
  ])
  const text = formatReport(analysis, { json: true })
  const json = JSON.parse(text)
  assert.deepEqual(Object.keys(json).sort(), ['freeCount', 'hint', 'models', 'recommended'])
  assert.deepEqual(Object.keys(json.models[0]).sort(), [
    'contextWindow', 'id', 'maxTokens', 'provider', 'status',
  ])
  assert.equal(json.freeCount, 1)
  assert.equal(json.recommended, 'opencode-go/hy4-flash-free')
  assert.ok(!text.includes('LEAK_'))
  assert.ok(!text.includes('secret'))
  assert.ok(!text.includes('password'))
})

test('analyze recommends nothing when no free models exist', () => {
  const analysis = analyze([{ id: 'pro', provider: 'opencode-go' }])
  assert.equal(analysis.freeCount, 0)
  assert.equal(analysis.recommended, null)
  assert.match(analysis.hint, /No free model is configured/)
  assert.doesNotMatch(formatReport(analysis), /Recommended default/)
})

test('redact strips common credential shapes', () => {
  assert.equal(redact('api_key=EXAMPLE_NOT_A_REAL_SECRET'), 'api_key=[redacted]')
  assert.equal(redact('https://x.dev/?token=EXAMPLE_NOT_A_REAL_TOKEN&y=1'), 'https://x.dev/?token=[redacted]&y=1')
})
