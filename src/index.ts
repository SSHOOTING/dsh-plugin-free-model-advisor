import { analyze, formatReport, redact, type Analysis } from './core.js'

export const name = 'dsh-plugin-free-model-advisor'

/** The command registry is the only host service we activate. */
export const inject = ['commands']

interface CommandContext {
  commands: {
    register(command: {
      name: string
      description: string
      input?: { hint?: string }
      handler: (args: { rawInput?: string }) =>
        | { kind: 'success'; text: string }
        | { kind: 'error'; text: string }
    }): () => void
  }
  /** Cordis lifecycle scope; registers disposables so disable/reload leaves no duplicate command. */
  effect?: (body: () => Generator, label?: string) => void
  logger?: { info?: (message: string) => void; warn?: (message: string) => void }
}

/**
 * DSH passes the bundle row's `config` as the SECOND argument to apply().
 * `ctx.config` is deliberately never read — it is not the plugin's config.
 */
function readModels(config: unknown): unknown {
  if (Array.isArray(config)) return config
  if (config === null || typeof config !== 'object') return undefined
  try {
    const record = config as Record<string, unknown>
    if ('models' in record) return record.models
  } catch {
    // hostile object — fall back to the shipped catalog
  }
  return undefined
}

/**
 * Cordis bundle entry. Registers `/free-models`, a read-only report that lists
 * configured free models and recommends a safe default. It only reads the
 * config object it was given; no network, file writes, or model calls occur.
 */
export function apply(ctx: CommandContext, config?: unknown): void {
  let analysis: Analysis
  try {
    analysis = analyze(readModels(config))
  } catch {
    analysis = analyze(undefined)
  }

  const dispose = ctx.commands.register({
    name: 'free-models',
    description: 'List configured free models and recommend a safe default (read-only)',
    input: { hint: '[--json]' },
    handler: ({ rawInput }) => {
      try {
        const json = (rawInput ?? '').trim() === '--json'
        return { kind: 'success', text: formatReport(analysis, { json }) }
      } catch (error) {
        const reason = redact(error instanceof Error ? error.message : String(error))
        return { kind: 'error', text: `[free-models] failed: ${reason}` }
      }
    },
  })

  if (typeof ctx.effect === 'function') {
    ctx.effect(function* () { yield dispose }, `${name} lifecycle`)
  }

  ctx.logger?.info?.('[dsh-plugin-free-model-advisor] loaded (read-only; /free-models available)')
}
