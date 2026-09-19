export type SourceKind = 'unifi_protect' | 'intelbras' | 'home_assistant' | 'other'

export interface SourceGroup {
  id: string
  name: string
  kind: SourceKind
}

export interface CameraSource {
  type: 'camera'
  id: string
  name: string
  group: string
  /** Nome do stream no go2rtc usado na grade (sub-stream, baixa resolução). */
  stream: string
  /** Nome do stream no go2rtc usado em tela cheia (stream principal). Opcional. */
  hdStream?: string
}

export interface DashboardSource {
  type: 'dashboard'
  id: string
  name: string
  group: string
  /** URL completa do painel (ex.: Home Assistant) exibido em iframe. */
  url: string
}

export type Source = CameraSource | DashboardSource

export interface View {
  id: string
  name: string
  columns: number
  rows: number
  /** IDs das fontes por posição (linha a linha). `null` deixa a célula vazia. */
  slots: (string | null)[]
}

export interface BlizzardConfig {
  /** Base do go2rtc vista pelo navegador. Com o nginx do projeto é "/go2rtc". */
  go2rtcUrl: string
  /** Ordem de tentativa do player: webrtc, mse, hls, mjpeg. */
  playerMode: string
  /** Intervalo do rodízio automático de visões, em segundos. 0 desliga. */
  rotationSeconds: number
  groups: SourceGroup[]
  sources: Source[]
  views: View[]
}

export const CONFIG_URL = '/config/blizzard.config.json'
export const CONFIG_STORAGE_KEY = 'blizzard.config.override'

export const emptyConfig: BlizzardConfig = {
  go2rtcUrl: '/go2rtc',
  playerMode: 'webrtc,mse,hls,mjpeg',
  rotationSeconds: 0,
  groups: [],
  sources: [],
  views: [],
}

export class ConfigError extends Error {}

function expectString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ConfigError(`"${path}" deve ser um texto não vazio.`)
  }
  return value
}

function expectNumber(value: unknown, path: string, fallback: number): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new ConfigError(`"${path}" deve ser um número maior ou igual a zero.`)
  }
  return value
}

function expectArray(value: unknown, path: string): unknown[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new ConfigError(`"${path}" deve ser uma lista.`)
  return value
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ConfigError(`"${path}" deve ser um objeto.`)
  }
  return value as Record<string, unknown>
}

const sourceKinds: SourceKind[] = ['unifi_protect', 'intelbras', 'home_assistant', 'other']

/** Valida e normaliza um JSON de configuração. Lança ConfigError com mensagem legível. */
export function parseConfig(raw: unknown): BlizzardConfig {
  const root = asRecord(raw, 'config')

  const groups: SourceGroup[] = expectArray(root.groups, 'groups').map((item, i) => {
    const g = asRecord(item, `groups[${i}]`)
    const kind = g.kind ?? 'other'
    if (!sourceKinds.includes(kind as SourceKind)) {
      throw new ConfigError(`"groups[${i}].kind" deve ser um de: ${sourceKinds.join(', ')}.`)
    }
    return {
      id: expectString(g.id, `groups[${i}].id`),
      name: expectString(g.name, `groups[${i}].name`),
      kind: kind as SourceKind,
    }
  })
  const groupIds = new Set(groups.map((g) => g.id))

  const sources: Source[] = expectArray(root.sources, 'sources').map((item, i) => {
    const s = asRecord(item, `sources[${i}]`)
    const id = expectString(s.id, `sources[${i}].id`)
    const name = expectString(s.name, `sources[${i}].name`)
    const group = expectString(s.group, `sources[${i}].group`)
    if (!groupIds.has(group)) {
      throw new ConfigError(`"sources[${i}].group" referencia o grupo "${group}", que não existe.`)
    }
    if (s.type === 'dashboard') {
      return { type: 'dashboard', id, name, group, url: expectString(s.url, `sources[${i}].url`) }
    }
    if (s.type === 'camera' || s.type === undefined) {
      const camera: CameraSource = {
        type: 'camera',
        id,
        name,
        group,
        stream: expectString(s.stream, `sources[${i}].stream`),
      }
      if (s.hdStream !== undefined) camera.hdStream = expectString(s.hdStream, `sources[${i}].hdStream`)
      return camera
    }
    throw new ConfigError(`"sources[${i}].type" deve ser "camera" ou "dashboard".`)
  })
  const sourceIds = new Set(sources.map((s) => s.id))
  if (sourceIds.size !== sources.length) throw new ConfigError('Há fontes com o mesmo "id".')

  const views: View[] = expectArray(root.views, 'views').map((item, i) => {
    const v = asRecord(item, `views[${i}]`)
    const columns = expectNumber(v.columns, `views[${i}].columns`, 2)
    const rows = expectNumber(v.rows, `views[${i}].rows`, 2)
    if (columns < 1 || rows < 1 || columns > 6 || rows > 6) {
      throw new ConfigError(`"views[${i}]" deve ter entre 1 e 6 colunas e linhas.`)
    }
    const slots = expectArray(v.slots, `views[${i}].slots`).map((slot, j) => {
      if (slot === null || slot === undefined || slot === '') return null
      const ref = expectString(slot, `views[${i}].slots[${j}]`)
      if (!sourceIds.has(ref)) {
        throw new ConfigError(`"views[${i}].slots[${j}]" referencia a fonte "${ref}", que não existe.`)
      }
      return ref
    })
    const total = columns * rows
    const normalized = Array.from({ length: total }, (_, k) => slots[k] ?? null)
    return {
      id: expectString(v.id, `views[${i}].id`),
      name: expectString(v.name, `views[${i}].name`),
      columns,
      rows,
      slots: normalized,
    }
  })
  if (new Set(views.map((v) => v.id)).size !== views.length) {
    throw new ConfigError('Há visões com o mesmo "id".')
  }

  return {
    go2rtcUrl: typeof root.go2rtcUrl === 'string' && root.go2rtcUrl ? root.go2rtcUrl.replace(/\/$/, '') : emptyConfig.go2rtcUrl,
    playerMode: typeof root.playerMode === 'string' && root.playerMode ? root.playerMode : emptyConfig.playerMode,
    rotationSeconds: expectNumber(root.rotationSeconds, 'rotationSeconds', 0),
    groups,
    sources,
    views,
  }
}

export interface LoadedConfig {
  config: BlizzardConfig
  /** "file" = veio de /config/blizzard.config.json; "local" = sobrescrita salva neste navegador. */
  origin: 'file' | 'local' | 'empty'
  error: string | null
}

export function readLocalOverride(): string | null {
  try {
    return window.localStorage.getItem(CONFIG_STORAGE_KEY)
  } catch {
    return null
  }
}

export function writeLocalOverride(json: string | null): void {
  try {
    if (json === null) window.localStorage.removeItem(CONFIG_STORAGE_KEY)
    else window.localStorage.setItem(CONFIG_STORAGE_KEY, json)
  } catch {
    // armazenamento indisponível (modo privado, quiosque restrito): segue sem persistir
  }
}

export async function loadConfig(): Promise<LoadedConfig> {
  const local = readLocalOverride()
  if (local !== null) {
    try {
      return { config: parseConfig(JSON.parse(local)), origin: 'local', error: null }
    } catch (err) {
      return { config: emptyConfig, origin: 'local', error: describeError(err) }
    }
  }
  try {
    const response = await fetch(`${CONFIG_URL}?t=${Date.now()}`, { cache: 'no-store' })
    if (!response.ok) {
      return { config: emptyConfig, origin: 'empty', error: `Não foi possível ler ${CONFIG_URL} (HTTP ${response.status}).` }
    }
    return { config: parseConfig(await response.json()), origin: 'file', error: null }
  } catch (err) {
    return { config: emptyConfig, origin: 'empty', error: describeError(err) }
  }
}

export function describeError(err: unknown): string {
  if (err instanceof SyntaxError) return `JSON inválido: ${err.message}`
  if (err instanceof Error) return err.message
  return String(err)
}

export function findSource(config: BlizzardConfig, id: string | null): Source | null {
  if (!id) return null
  return config.sources.find((s) => s.id === id) ?? null
}

export function findGroup(config: BlizzardConfig, id: string): SourceGroup | null {
  return config.groups.find((g) => g.id === id) ?? null
}
