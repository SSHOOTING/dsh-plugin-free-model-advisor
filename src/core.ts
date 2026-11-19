/**
 * Pure, dependency-free core for dsh-plugin-free-model-advisor.
 *
 * Reads only a caller-supplied `models` config object (a list or map of model
 * descriptors). It never changes configuration, reads files, calls the network,
 * or invokes a model. Every emitted string is redacted before it is printed.
 */

export interface ModelInput {
  id: string
  provider?: string
  contextWindow?: number
  maxTokens?: number
  /** An explicit opt-in mark. Never inferred from anything else. */
  free?: boolean
}

export type ModelStatus = 'free' | 'unknown'

/** Public row shape. Only known fields are ever serialized. */
export interface ModelRow {
  id: string
  provider?: string
  contextWindow?: number
  maxTokens?: number
  status: ModelStatus
}

export interface Analysis {
  models: ModelRow[]
  freeCount: number
  recommended: string | null
  hint: string
}

export interface ReportOptions {
  json?: boolean
}

/**
 * The only catalog we ship. Paid models are never included, and nothing is
 * assumed free unless it is in this list or explicitly marked by the caller.
 */
export const DEFAULT_MODELS: readonly ModelInput[] = [
  { id: 'hy4-flash-free', provider: 'opencode-go', contextWindow: 1048576, free: true },
  { id: 'longcat-2.5-free', provider: 'opencode-go', contextWindow: 1000000, free: true },
]

const SECRET =
  /((?:token|key|secret|password|authorization|bearer)[^\s:=]{0,24}[:=]\s*)[^\s&]+/gi
const QUERY_SECRET = /([?&](?:token|key|secret|password|auth)=)[^&#\s]+/gi

/** Strip credential-looking substrings before anything is printed. */
export function redact(value: unknown): string {
  let text: string
  try {
    text = value instanceof Error ? value.stack || value.message : String(value)
  } catch {
    return '[unprintable]'
  }
  return text.replace(SECRET, '$1[redacted]').replace(QUERY_SECRET, '$1[redacted]')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Property read that cannot be turned into a throw by a hostile object. */
function get(record: Record<string, unknown>, key: string): unknown {
  try {
    return record[key]
  } catch {
    return undefined
  }
}

function safeString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function safeCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}

/** Split a map key such as `opencode-go/hy4-flash-free` into provider + id. */
function fromKey(key: string): { id: string; provider?: string } {
  const slash = key.indexOf('/')
  if (slash > 0 && slash < key.length - 1) {
    return { provider: key.slice(0, slash), id: key.slice(slash + 1) }
  }
  return { id: key }
}

/** Copy only the known fields off an untrusted descriptor. */
function normalizeOne(input: unknown, fallbackId?: string): ModelInput | null {
  if (!isRecord(input)) return null
  const id = safeString(get(input, 'id')) ?? fallbackId
  if (!id) return null

  const row: ModelInput = { id }
  const provider = safeString(get(input, 'provider'))
  if (provider !== undefined) row.provider = provider
  const contextWindow = safeCount(get(input, 'contextWindow'))
  if (contextWindow !== undefined) row.contextWindow = contextWindow
  const maxTokens = safeCount(get(input, 'maxTokens'))
  if (maxTokens !== undefined) row.maxTokens = maxTokens
  if (get(input, 'free') === true) row.free = true
  return row
}

/**
 * A model is free only when it is explicitly marked `free: true`, OR its id
 * ends with `-free` and its provider is absent or `opencode-go`. Everything
 * else is `unknown` and is never recommended.
 */
export function classify(value: unknown): ModelStatus {
  if (!isRecord(value)) return 'unknown'
  if (get(value, 'free') === true) return 'free'
  const id = get(value, 'id')
  if (typeof id === 'string' && id.endsWith('-free')) {
    const provider = get(value, 'provider')
    if (provider === undefined || provider === 'opencode-go') return 'free'
  }
  return 'unknown'
}

function toRow(model: ModelInput): ModelRow {
  const row: ModelRow = { id: model.id, status: classify(model) }
  if (model.provider !== undefined) row.provider = model.provider
  if (model.contextWindow !== undefined) row.contextWindow = model.contextWindow
  if (model.maxTokens !== undefined) row.maxTokens = model.maxTokens
  return row
}

function defaultRows(): ModelRow[] {
  return DEFAULT_MODELS.map(toRow)
}

/**
 * Normalize untrusted config into a list of known-field rows. Accepts either
 * an array of descriptors or a map keyed by id (or `provider/id`). Malformed,
 * empty, or hostile input falls back to the default free catalog. Never throws.
 */
export function normalizeModels(value: unknown): ModelRow[] {
  try {
    const found: ModelInput[] = []

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const row = normalizeOne(value[i])
        if (row) found.push(row)
      }
    } else if (isRecord(value)) {
      for (const key of Object.keys(value)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
        const fallback = fromKey(key)
        const row = normalizeOne(get(value, key), fallback.id)
        if (!row) continue
        if (row.provider === undefined && fallback.provider !== undefined) {
          row.provider = fallback.provider
        }
        found.push(row)
      }
    }

    return found.length > 0 ? found.map(toRow) : defaultRows()
  } catch {
    return defaultRows()
  }
}

/** Prefer `hy4-flash-free`; otherwise take the first other free model. */
export function recommend(rows: readonly ModelRow[]): ModelRow | null {
  const free = rows.filter((row) => row.status === 'free')
  if (free.length === 0) return null
  return free.find((row) => row.id === 'hy4-flash-free') ?? free[0]
}

function qualify(row: ModelRow): string {
  return row.provider ? `${row.provider}/${row.id}` : row.id
}

/** Analyze a `models` config (or fall back to the shipped free catalog). */
export function analyze(value: unknown): Analysis {
  const models = normalizeModels(value)
  const freeCount = models.reduce((total, row) => total + (row.status === 'free' ? 1 : 0), 0)
  const pick = recommend(models)
  const recommended = pick ? qualify(pick) : null
  const hint = recommended
    ? `Set your default model to ${recommended} (free). Configure via cordis.patch.yml, or install with \`dsh plugin add dsh-plugin-free-model-advisor\`.`
    : 'No free model is configured. Add opencode-go/hy4-flash-free to cordis.patch.yml, or install with `dsh plugin add dsh-plugin-free-model-advisor`.'
  return { models, freeCount, recommended, hint }
}

/** Compact text report, or a curated JSON object containing only known fields. */
export function formatReport(analysis: Analysis, options: ReportOptions = {}): string {
  if (options.json) {
    const json = {
      models: analysis.models.map((row) => {
        const out: Record<string, unknown> = { id: redact(row.id), status: row.status }
        if (row.provider !== undefined) out.provider = redact(row.provider)
        if (row.contextWindow !== undefined) out.contextWindow = row.contextWindow
        if (row.maxTokens !== undefined) out.maxTokens = row.maxTokens
        return out
      }),
      freeCount: analysis.freeCount,
      recommended: analysis.recommended === null ? null : redact(analysis.recommended),
      hint: redact(analysis.hint),
    }
    return JSON.stringify(json, null, 2)
  }

  const head = `[free-models] ${analysis.freeCount}/${analysis.models.length} configured models are FREE`
  const lines = analysis.models.map((row) => {
    const parts = [redact(qualify(row))]
    if (row.contextWindow !== undefined) {
      parts.push(`ctx ${redact(row.contextWindow.toLocaleString('en-US'))}`)
    }
    parts.push(row.status.toUpperCase())
    return `  ${parts.join('  ')}`
  })
  const chosen = analysis.recommended
    ? `\nRecommended default: ${redact(analysis.recommended)}`
    : ''
  return [head, ...lines].join('\n') + chosen + `\nHint: ${redact(analysis.hint)}`
}

/** Convenience: analyze and format in one read-only step. */
export function report(value: unknown, options: ReportOptions = {}): string {
  return formatReport(analyze(value), options)
}
