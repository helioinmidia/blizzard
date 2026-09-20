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
  /** "api" = servidor (gravável); "file" = arquivo estático (somente leitura); "empty" = nada carregado. */
  origin: 'api' | 'file' | 'empty'
  error: string | null
}

export const CONFIG_API = '/api/config'
const LEGACY_STORAGE_KEY = 'blizzard.config.override'

/** Remove sobrescritas antigas guardadas no navegador: a configuração agora vive só no servidor. */
function dropLegacyLocalOverride(): void {
  try {
    window.localStorage.removeItem(LEGACY_STORAGE_KEY)
  } catch {
    // sem localStorage: nada a limpar
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string }
    if (body && typeof body.error === 'string') return body.error
  } catch {
    // corpo não é JSON
  }
  return `HTTP ${response.status}`
}

/** Lê a configuração do servidor; sem a API (ex.: servidor estático), cai para o arquivo somente leitura. */
export async function loadConfig(): Promise<LoadedConfig> {
  dropLegacyLocalOverride()
  try {
    const response = await fetch(CONFIG_API, { cache: 'no-store' })
    if (response.ok) {
      return { config: parseConfig(await response.json()), origin: 'api', error: null }
    }
    if (response.status !== 404 && response.status !== 502 && response.status !== 503) {
      return { config: emptyConfig, origin: 'empty', error: `Servidor de configuração: ${await readErrorMessage(response)}` }
    }
  } catch (err) {
    if (err instanceof ConfigError || err instanceof SyntaxError) {
      return { config: emptyConfig, origin: 'api', error: describeError(err) }
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

/** Grava a configuração no servidor. Lança Error com mensagem legível em caso de falha. */
export async function saveConfig(config: BlizzardConfig): Promise<BlizzardConfig> {
  const normalized = parseConfig(config)
  const response = await fetch(CONFIG_API, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(normalized, null, 2),
  })
  if (!response.ok) {
    throw new Error(`Não foi possível salvar no servidor: ${await readErrorMessage(response)}`)
  }
  return parseConfig(await response.json())
}

/** Texto canônico para comparar duas configurações. */
export function serializeConfig(config: BlizzardConfig): string {
  return JSON.stringify(config)
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
