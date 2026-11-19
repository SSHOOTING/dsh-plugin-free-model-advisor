import test from 'node:test'
import assert from 'node:assert/strict'
import { name, inject, apply } from '../lib/index.js'

function makeCtx(extra = {}) {
  const registered = []
  const logs = []
  const effects = []
  let disposed = 0
  return {
    registered,
    logs,
    effects,
    get disposed() { return disposed },
    commands: {
      register: (command) => {
        registered.push(command)
        return () => { disposed++ }
      },
    },
    effect: (body) => { effects.push([...body()]) },
    logger: { info: (m) => logs.push(m) },
    ...extra,
  }
}

test('entry exports the bundle name and injects only commands', () => {
  assert.equal(name, 'dsh-plugin-free-model-advisor')
  assert.deepEqual(inject, ['commands'])
})

test('apply registers /free-models once and ties disposal to the Cordis lifecycle', () => {
  const ctx = makeCtx()
  apply(ctx)
  assert.equal(ctx.registered.length, 1)
  assert.equal(ctx.registered[0].name, 'free-models')
  assert.equal(ctx.effects.length, 1)
  assert.equal(ctx.effects[0].length, 1)
  ctx.effects[0][0]()
  assert.equal(ctx.disposed, 1)
  assert.match(ctx.logs[0], /loaded/)
})

test('handler uses the models from the second apply argument', () => {
  const ctx = makeCtx()
  apply(ctx, { models: [{ id: 'custom-free', provider: 'opencode-go', free: true }] })
  const result = ctx.registered[0].handler({ rawInput: '' })
  assert.equal(result.kind, 'success')
  assert.match(result.text, /custom-free/)
  assert.match(result.text, /Recommended default: opencode-go\/custom-free/)
})

test('handler ignores ctx.config and uses only the second apply argument', () => {
  const ctx = makeCtx({ config: { models: [{ id: 'ctx-config-evil', free: true }] } })
  apply(ctx)
  const result = ctx.registered[0].handler({ rawInput: '--json' })
  assert.equal(result.kind, 'success')
  const json = JSON.parse(result.text)
  assert.equal(json.recommended, 'opencode-go/hy4-flash-free')
  assert.deepEqual(json.models.map((m) => m.id), ['hy4-flash-free', 'longcat-2.5-free'])
  assert.ok(!result.text.includes('ctx-config-evil'))
})

test('handler supports --json, a missing rawInput, and no effect hook', () => {
  const ctx = makeCtx()
  delete ctx.effect
  apply(ctx)
  const cmd = ctx.registered[0]
  const json = cmd.handler({ rawInput: '--json' })
  assert.equal(JSON.parse(json.text).freeCount, 2)
  const text = cmd.handler({})
  assert.match(text.text, /\[free-models\] 2\/2 configured models are FREE/)
})

test('handler survives hostile config and falls back to the safe catalog', () => {
  const throwing = new Proxy(
    {},
    {
      get() { throw new Error('boom') },
      ownKeys() { throw new Error('boom') },
    },
  )
  const ctx = makeCtx()
  assert.doesNotThrow(() => apply(ctx, { models: throwing }))
  assert.doesNotThrow(() => apply(makeCtx(), throwing))
  const result = ctx.registered[0].handler({ rawInput: '--json' })
  assert.equal(result.kind, 'success')
  assert.equal(JSON.parse(result.text).freeCount, 2)
})
