import type { HaCard } from './config'

export interface HaEntityState {
  state: string
  attributes: {
    friendly_name?: string
    unit_of_measurement?: string
    device_class?: string
    current_position?: number
    current_temperature?: number
    temperature?: number
    hvac_action?: string
    humidity?: number
    wind_speed?: number
    wind_speed_unit?: string
    temperature_unit?: string
  }
  last_changed: string | null
}

export interface HaForecastDay {
  datetime: string
  condition?: string
  temperature?: number
  templow?: number
  precipitation?: number
  precipitation_probability?: number
}

/** Pontos [instante em ms, valor] já reduzidos pela ponte. */
export type HaSeries = Record<string, [number, number][]>

export interface HaSnapshot {
  /** "connecting" até a primeira resposta; "offline" = a ponte respondeu, mas está sem o Home Assistant. */
  status: 'connecting' | 'online' | 'offline' | 'unreachable'
  states: Record<string, HaEntityState>
  forecasts: Record<string, HaForecastDay[]>
}

type Listener = () => void

/** Uma conexão SSE por URL de ponte, compartilhada por todas as células que a usam. */
class HaStore {
  private snapshot: HaSnapshot = { status: 'connecting', states: {}, forecasts: {} }
  private listeners = new Set<Listener>()
  private stream: EventSource | null = null
  private readonly bridgeUrl: string

  constructor(bridgeUrl: string) {
    this.bridgeUrl = bridgeUrl
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    if (this.listeners.size === 1) this.open()
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) this.close()
    }
  }

  getSnapshot = (): HaSnapshot => this.snapshot

  private set(next: HaSnapshot) {
    this.snapshot = next
    for (const listener of this.listeners) listener()
  }

  private open() {
    const stream = new EventSource(`${this.bridgeUrl}/events`)
    this.stream = stream
    stream.addEventListener('snapshot', (ev) => {
      const data = JSON.parse((ev as MessageEvent<string>).data) as {
        connected: boolean
        states: HaSnapshot['states']
        forecasts?: HaSnapshot['forecasts']
      }
      this.set({ status: data.connected ? 'online' : 'offline', states: data.states, forecasts: data.forecasts ?? {} })
    })
    stream.addEventListener('forecast', (ev) => {
      const data = JSON.parse((ev as MessageEvent<string>).data) as { entity_id: string; forecast: HaForecastDay[] }
      this.set({ ...this.snapshot, forecasts: { ...this.snapshot.forecasts, [data.entity_id]: data.forecast } })
    })
    stream.addEventListener('state', (ev) => {
      const data = JSON.parse((ev as MessageEvent<string>).data) as { entity_id: string; state: HaEntityState | null }
      const states = { ...this.snapshot.states }
      if (data.state === null) delete states[data.entity_id]
      else states[data.entity_id] = data.state
      this.set({ ...this.snapshot, states })
    })
    stream.addEventListener('status', (ev) => {
      const data = JSON.parse((ev as MessageEvent<string>).data) as { connected: boolean }
      this.set({ ...this.snapshot, status: data.connected ? 'online' : 'offline' })
    })
    // O EventSource reconecta sozinho; os últimos valores continuam na tela, marcados como desatualizados.
    stream.onerror = () => this.set({ ...this.snapshot, status: 'unreachable' })
  }

  private close() {
    this.stream?.close()
    this.stream = null
    this.snapshot = { status: 'connecting', states: {}, forecasts: {} }
  }
}

/** Busca periódica de /history ou /statistics, uma por URL, compartilhada pelos cartões que a usam. */
class SeriesStore {
  private series: HaSeries | null = null
  private listeners = new Set<Listener>()
  private timer: number | null = null
  private readonly url: string
  private readonly intervalMs: number

  constructor(url: string, intervalMs: number) {
    this.url = url
    this.intervalMs = intervalMs
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    if (this.listeners.size === 1) {
      void this.load()
      this.timer = window.setInterval(() => void this.load(), this.intervalMs)
    }
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0 && this.timer !== null) {
        window.clearInterval(this.timer)
        this.timer = null
      }
    }
  }

  getSnapshot = (): HaSeries | null => this.series

  private async load() {
    try {
      const response = await fetch(this.url, { cache: 'no-store' })
      if (!response.ok) return // mantém o último gráfico bom na tela
      const body = (await response.json()) as { series: HaSeries }
      this.series = body.series
      for (const listener of this.listeners) listener()
    } catch {
      // ponte fora do ar: tenta de novo no próximo ciclo
    }
  }
}

const seriesStores = new Map<string, SeriesStore>()

export function haSeriesStore(bridgeUrl: string, feed: 'history' | 'statistics'): SeriesStore {
  const url = `${bridgeUrl}/${feed}`
  let store = seriesStores.get(url)
  if (!store) {
    store = new SeriesStore(url, feed === 'history' ? 120_000 : 600_000)
    seriesStores.set(url, store)
  }
  return store
}

const stores = new Map<string, HaStore>()

export function haStore(bridgeUrl: string): HaStore {
  let store = stores.get(bridgeUrl)
  if (!store) {
    store = new HaStore(bridgeUrl)
    stores.set(bridgeUrl, store)
  }
  return store
}

export type Tone = 'neutral' | 'active' | 'alert' | 'muted'

export interface EntityView {
  value: string
  /** Complemento discreto ao lado do valor (posição da persiana, "há 5 min"…). */
  detail?: string
  tone: Tone
}

const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 })

export function isAvailable(entity: HaEntityState | undefined): entity is HaEntityState {
  return entity !== undefined && entity.state !== 'unavailable' && entity.state !== 'unknown'
}

function domainOf(entityId: string): string {
  return entityId.slice(0, entityId.indexOf('.'))
}

function numericValue(entity: HaEntityState): number | null {
  if (entity.state.trim() === '') return null
  const value = Number(entity.state)
  return Number.isFinite(value) ? value : null
}

function withUnit(value: number, unit: string | undefined): string {
  if (!unit) return number.format(value)
  return unit === '%' ? `${number.format(value)}%` : `${number.format(value)} ${unit}`
}

export function timeAgo(iso: string | null, now: number): string | undefined {
  if (!iso) return undefined
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (!Number.isFinite(seconds)) return undefined
  if (seconds < 60) return 'agora'
  if (seconds < 3600) return `há ${Math.floor(seconds / 60)} min`
  if (seconds < 86_400) return `há ${Math.floor(seconds / 3600)} h`
  return `há ${Math.floor(seconds / 86_400)} d`
}

const MOTION = ['motion', 'occupancy', 'presence', 'moving']
const OPENING = ['door', 'window', 'opening', 'garage_door']
const HAZARD = ['problem', 'smoke', 'gas', 'carbon_monoxide', 'moisture', 'heat', 'safety', 'tamper', 'vibration']

const coverStates: Record<string, string> = { open: 'Aberta', closed: 'Fechada', opening: 'Abrindo', closing: 'Fechando' }
const hvacStates: Record<string, string> = {
  off: 'Desligado',
  cool: 'Resfriando',
  heat: 'Aquecendo',
  heat_cool: 'Automático',
  auto: 'Automático',
  dry: 'Desumidificando',
  fan_only: 'Ventilando',
}
const alarmStates: Record<string, string> = {
  disarmed: 'Desarmado',
  arming: 'Armando',
  pending: 'Pendente',
  triggered: 'Disparado',
}

export function isMotion(entityId: string, entity: HaEntityState | undefined): boolean {
  return domainOf(entityId) === 'binary_sensor' && MOTION.includes(entity?.attributes.device_class ?? '')
}

/** Traduz o estado bruto do Home Assistant para o texto e a cor mostrados no cartão. */
export function describeEntity(entityId: string, entity: HaEntityState | undefined, now: number): EntityView {
  if (!isAvailable(entity)) return { value: entity ? 'Indisponível' : 'Sem dados', tone: 'muted' }

  const domain = domainOf(entityId)
  const deviceClass = entity.attributes.device_class ?? ''
  const on = entity.state === 'on'

  switch (domain) {
    case 'sensor':
    case 'number':
    case 'input_number':
    case 'counter': {
      const value = numericValue(entity)
      if (value === null) return { value: entity.state, tone: 'neutral' }
      return { value: withUnit(value, entity.attributes.unit_of_measurement), tone: 'neutral' }
    }
    case 'binary_sensor': {
      if (MOTION.includes(deviceClass)) {
        return on
          ? { value: 'Movimento', tone: 'active' }
          : { value: 'Livre', detail: timeAgo(entity.last_changed, now), tone: 'neutral' }
      }
      if (OPENING.includes(deviceClass)) {
        return on ? { value: 'Aberta', detail: timeAgo(entity.last_changed, now), tone: 'alert' } : { value: 'Fechada', tone: 'neutral' }
      }
      if (deviceClass === 'connectivity') return on ? { value: 'Online', tone: 'neutral' } : { value: 'Offline', tone: 'alert' }
      if (HAZARD.includes(deviceClass)) return on ? { value: 'Alerta', tone: 'alert' } : { value: 'Normal', tone: 'neutral' }
      return on ? { value: 'Ligado', tone: 'active' } : { value: 'Desligado', tone: 'neutral' }
    }
    case 'cover': {
      const position = entity.attributes.current_position
      const partial = typeof position === 'number' && position > 0 && position < 100
      return {
        value: coverStates[entity.state] ?? entity.state,
        detail: partial ? `${position}%` : undefined,
        tone: entity.state === 'closed' ? 'neutral' : 'active',
      }
    }
    case 'climate': {
      const current = entity.attributes.current_temperature
      return {
        value: hvacStates[entity.state] ?? entity.state,
        detail: typeof current === 'number' ? withUnit(current, '°C') : undefined,
        tone: entity.state === 'off' ? 'neutral' : 'active',
      }
    }
    case 'person':
    case 'device_tracker':
      if (entity.state === 'home') return { value: 'Em casa', tone: 'active' }
      if (entity.state === 'not_home') return { value: 'Fora', detail: timeAgo(entity.last_changed, now), tone: 'neutral' }
      return { value: entity.state, tone: 'neutral' }
    case 'lock':
      if (entity.state === 'locked') return { value: 'Trancada', tone: 'neutral' }
      if (entity.state === 'unlocked') return { value: 'Destrancada', tone: 'alert' }
      return { value: entity.state, tone: 'neutral' }
    case 'alarm_control_panel':
      if (entity.state.startsWith('armed')) return { value: 'Armado', tone: 'active' }
      return { value: alarmStates[entity.state] ?? entity.state, tone: entity.state === 'triggered' ? 'alert' : 'neutral' }
    case 'light':
    case 'switch':
    case 'fan':
    case 'input_boolean':
      return on ? { value: 'Ligado', tone: 'active' } : { value: 'Desligado', tone: 'neutral' }
    default:
      return { value: entity.state, tone: 'neutral' }
  }
}

export interface CardSummary {
  text: string
  tone: Tone
}

/** Resumo no cabeçalho do cartão; só aparece quando todas as entidades são do mesmo tipo. */
export function summarizeCard(card: HaCard, states: HaSnapshot['states']): CardSummary | null {
  if (card.kind !== 'list') return null
  const ids = card.entities.map((e) => e.entity)
  if (ids.length < 2) return null
  const available = ids.filter((id) => isAvailable(states[id]))
  if (available.length === 0) return null
  const domains = new Set(ids.map(domainOf))
  if (domains.size !== 1) return null
  const domain = [...domains][0]

  if (domain === 'sensor') {
    const units = new Set(available.map((id) => states[id].attributes.unit_of_measurement ?? ''))
    const values = available.map((id) => numericValue(states[id])).filter((v): v is number => v !== null)
    if (units.size !== 1 || values.length < 2) return null
    const unit = [...units][0]
    return { text: `${number.format(Math.min(...values))} – ${withUnit(Math.max(...values), unit)}`, tone: 'neutral' }
  }
  if (domain === 'cover') {
    const open = available.filter((id) => states[id].state !== 'closed').length
    return open === 0 ? { text: 'Todas fechadas', tone: 'neutral' } : { text: `${open} de ${available.length} abertas`, tone: 'active' }
  }
  if (domain === 'binary_sensor') {
    const active = available.filter((id) => states[id].state === 'on').length
    if (ids.every((id) => isMotion(id, states[id]) || !isAvailable(states[id]))) {
      return active === 0 ? { text: 'Sem movimento', tone: 'neutral' } : { text: `${active} com movimento`, tone: 'active' }
    }
    const alerting = available.filter((id) => describeEntity(id, states[id], 0).tone === 'alert').length
    if (alerting > 0) return { text: `${alerting} em alerta`, tone: 'alert' }
    return active === 0 ? { text: 'Tudo normal', tone: 'neutral' } : { text: `${active} ativos`, tone: 'active' }
  }
  if (domain === 'climate' || domain === 'light' || domain === 'switch') {
    const active = available.filter((id) => states[id].state !== 'off').length
    return active === 0 ? { text: 'Tudo desligado', tone: 'neutral' } : { text: `${active} ligados`, tone: 'active' }
  }
  return null
}

/** Cartões só de sensores numéricos viram uma grade de números grandes; os demais, uma lista. */
export function isStatCard(card: HaCard): boolean {
  return card.kind === 'list' && card.entities.length > 0 && card.entities.every((e) => domainOf(e.entity) === 'sensor')
}

const conditions: Record<string, string> = {
  'clear-night': 'Céu limpo',
  cloudy: 'Nublado',
  exceptional: 'Alerta',
  fog: 'Neblina',
  hail: 'Granizo',
  lightning: 'Trovoadas',
  'lightning-rainy': 'Tempestade',
  partlycloudy: 'Parcialmente nublado',
  pouring: 'Chuva forte',
  rainy: 'Chuva',
  snowy: 'Neve',
  'snowy-rainy': 'Chuva com neve',
  sunny: 'Ensolarado',
  windy: 'Vento',
  'windy-variant': 'Vento',
}

export function conditionLabel(condition: string | undefined): string {
  return condition ? conditions[condition] ?? condition : '—'
}

export function formatNumber(value: number, unit?: string): string {
  return withUnit(value, unit)
}
