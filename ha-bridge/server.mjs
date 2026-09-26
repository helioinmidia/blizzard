// Blizzard · ponte do Home Assistant
//
// Mantém o token do HA no servidor e entrega ao navegador, por SSE, somente os estados das entidades
// citadas nas fontes "ha" do blizzard.config.json. É somente leitura: não há rota que chame serviços.
//
//   GET /states      → { connected, states, forecasts }          (foto atual)
//   GET /events      → SSE: "snapshot", "state", "forecast", "status" (tempo real)
//   GET /history     → { hours, series: { entity_id: [[ms, valor], …] } }   cartões "graph"
//   GET /statistics  → { series: { entity_id: [[ms, variação], …] } }       cartões "bars" (por hora, 48 h)
//   GET /health      → { connected, entities }
//
// Sem dependências: usa o WebSocket global do Node 22+.
import { createServer } from 'node:http'
import { readFileSync, watchFile } from 'node:fs'

const HA_URL = (process.env.HA_URL ?? '').replace(/\/$/, '')
const HA_TOKEN = (process.env.HA_TOKEN ?? '').trim()
const CONFIG_PATH = process.env.BLIZZARD_CONFIG ?? '/config/blizzard.config.json'
const PORT = Number(process.env.HA_BRIDGE_PORT ?? 8099)
const HOST = process.env.HA_BRIDGE_HOST ?? '127.0.0.1'

// Só o que os cartões usam; o resto dos atributos não sai do servidor.
const KEPT_ATTRIBUTES = [
  'friendly_name',
  'unit_of_measurement',
  'device_class',
  'current_position',
  'current_temperature',
  'temperature',
  'hvac_action',
  'humidity',
  'wind_speed',
  'wind_speed_unit',
  'temperature_unit',
]

const log = (...args) => console.log(new Date().toISOString(), ...args)

if (!HA_URL || !HA_TOKEN) {
  log('HA_URL e HA_TOKEN são obrigatórios (arquivo .env). Os cartões do Home Assistant ficarão sem dados.')
}

/** @type {Map<string, {state: string, attributes: Record<string, unknown>, last_changed: string | null}>} */
const states = new Map()
/** @type {Set<import('node:http').ServerResponse>} */
const clients = new Set()
let entityIds = []
let wanted = { entities: new Set(), history: new Set(), statistics: new Set(), weather: new Set(), hours: 24 }
/** @type {Map<string, object[]>} */
const forecasts = new Map()
/** Pedidos em andamento no WebSocket do HA: id → resolve. */
const pendingRequests = new Map()
/** Assinaturas de previsão do tempo: id da mensagem → entidade. */
const forecastSubscriptions = new Map()
const cache = new Map()
let connected = false
let socket = null
let reconnectTimer = null
let reconnectDelay = 1000
let failedAttempts = 0
let lastActivity = 0
let authenticated = false
let nextId = 2

/** Entidades citadas nas fontes "ha", separadas pelo que cada tipo de cartão precisa da ponte. */
function readWanted() {
  try {
    const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
    const wanted = { entities: new Set(), history: new Set(), statistics: new Set(), weather: new Set(), hours: 24 }
    for (const source of config.sources ?? []) {
      if (source?.type !== 'ha') continue
      for (const card of source.cards ?? []) {
        for (const item of card?.entities ?? []) {
          const id = typeof item === 'string' ? item : item?.entity
          if (typeof id !== 'string' || !/^[a-z_]+\.[a-z0-9_]+$/.test(id)) continue
          if (card.kind === 'bars') wanted.statistics.add(id)
          else wanted.entities.add(id)
          if (card.kind === 'graph') {
            wanted.history.add(id)
            if (Number.isFinite(card.hours)) wanted.hours = Math.min(72, Math.max(wanted.hours, card.hours))
          }
          if (card.kind === 'weather' && id.startsWith('weather.')) wanted.weather.add(id)
        }
      }
    }
    // Temperatura do cabeçalho (chave "temperature" na raiz da configuração).
    const headerEntity = config.temperature?.entity
    if (typeof headerEntity === 'string' && /^[a-z_]+\.[a-z0-9_]+$/.test(headerEntity)) {
      wanted.entities.add(headerEntity)
      if (headerEntity.startsWith('weather.')) wanted.weather.add(headerEntity)
    }
    return wanted
  } catch (err) {
    log(`Não foi possível ler ${CONFIG_PATH}: ${err.message}`)
    return null
  }
}

function broadcast(event, data) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const res of clients) res.write(frame)
}

function snapshot() {
  return { connected, states: Object.fromEntries(states), forecasts: Object.fromEntries(forecasts) }
}

function setConnected(value) {
  if (connected === value) return
  connected = value
  broadcast('status', { connected })
}

function trimAttributes(attributes) {
  const out = {}
  for (const key of KEPT_ATTRIBUTES) if (attributes?.[key] !== undefined) out[key] = attributes[key]
  return out
}

const toIso = (seconds) => (typeof seconds === 'number' ? new Date(seconds * 1000).toISOString() : null)

// Formato compacto do subscribe_entities: a = adicionadas, c = alteradas ("+" e "-"), r = removidas.
function applyEntitiesEvent(event) {
  for (const [id, e] of Object.entries(event.a ?? {})) {
    states.set(id, { state: String(e.s), attributes: trimAttributes(e.a), last_changed: toIso(e.lc) })
  }
  const changed = []
  for (const [id, diff] of Object.entries(event.c ?? {})) {
    const current = states.get(id) ?? { state: 'unknown', attributes: {}, last_changed: null }
    const plus = diff['+'] ?? {}
    const attributes = { ...current.attributes, ...trimAttributes(plus.a) }
    for (const key of diff['-']?.a ?? []) delete attributes[key]
    const next = {
      state: plus.s !== undefined ? String(plus.s) : current.state,
      attributes,
      last_changed: plus.lc !== undefined ? toIso(plus.lc) : current.last_changed,
    }
    states.set(id, next)
    changed.push([id, next])
  }
  for (const id of event.r ?? []) {
    states.delete(id)
    changed.push([id, null])
  }
  return changed
}

function scheduleReconnect() {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, reconnectDelay)
  reconnectDelay = Math.min(reconnectDelay * 2, 30_000)
}

/** Descarta o socket atual (se houver) e agenda nova tentativa. Pode ser chamada várias vezes sem efeito colateral. */
function dropSocket(reason) {
  const ws = socket
  socket = null
  if (ws) {
    ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null
    try {
      ws.close()
    } catch {
      // socket já encerrado
    }
  }
  for (const settle of pendingRequests.values()) settle({ success: false, error: { message: 'conexão com o Home Assistant caiu' } })
  pendingRequests.clear()
  if (connected) log(`Conexão com o Home Assistant caiu (${reason}); tentando de novo.`)
  else if (++failedAttempts % 10 === 0) log(`Ainda sem conexão com o Home Assistant (${reason}); ${failedAttempts} tentativas.`)
  setConnected(false)
  scheduleReconnect()
}

function connect() {
  if (!HA_URL || !HA_TOKEN) return
  if (socket) {
    const old = socket
    socket = null
    old.onopen = old.onmessage = old.onerror = old.onclose = null
    try {
      old.close()
    } catch {
      // socket já encerrado
    }
  }
  if (entityIds.length === 0) {
    log('Nenhuma entidade configurada em fontes "ha"; aguardando mudança na configuração.')
    states.clear()
    setConnected(false)
    return
  }

  let ws
  try {
    ws = new WebSocket(`${HA_URL.replace(/^http/, 'ws')}/api/websocket`)
  } catch (err) {
    log(`HA_URL inválida: ${err.message}`)
    return
  }
  socket = ws
  lastActivity = Date.now()
  authenticated = false
  nextId = 2
  let first = true

  ws.onmessage = (message) => {
    if (socket !== ws) return
    lastActivity = Date.now()
    let msg
    try {
      msg = JSON.parse(message.data)
    } catch {
      return
    }
    if (msg.type === 'auth_required') {
      ws.send(JSON.stringify({ type: 'auth', access_token: HA_TOKEN }))
    } else if (msg.type === 'auth_invalid') {
      log('Home Assistant recusou o token (auth_invalid). Confira HA_TOKEN no .env.')
      reconnectDelay = 30_000
      dropSocket('token recusado')
    } else if (msg.type === 'auth_ok') {
      log(`Conectado ao Home Assistant ${msg.ha_version ?? ''}; acompanhando ${entityIds.length} entidades.`)
      reconnectDelay = 1000
      failedAttempts = 0
      authenticated = true
      ws.send(JSON.stringify({ id: 1, type: 'subscribe_entities', entity_ids: entityIds }))
      forecastSubscriptions.clear()
      for (const entity of wanted.weather) {
        const id = nextId++
        forecastSubscriptions.set(id, entity)
        ws.send(JSON.stringify({ id, type: 'weather/subscribe_forecast', forecast_type: 'daily', entity_id: entity }))
      }
    } else if (msg.type === 'result' && pendingRequests.has(msg.id)) {
      const settle = pendingRequests.get(msg.id)
      pendingRequests.delete(msg.id)
      settle(msg)
    } else if (msg.type === 'result' && msg.success === false) {
      log(`Home Assistant devolveu erro: ${msg.error?.message ?? 'desconhecido'}`)
    } else if (msg.type === 'event' && forecastSubscriptions.has(msg.id)) {
      const entity = forecastSubscriptions.get(msg.id)
      const days = (msg.event?.forecast ?? []).slice(0, 6).map((day) => ({
        datetime: day.datetime,
        condition: day.condition,
        temperature: day.temperature,
        templow: day.templow,
        precipitation: day.precipitation,
        precipitation_probability: day.precipitation_probability,
      }))
      forecasts.set(entity, days)
      broadcast('forecast', { entity_id: entity, forecast: days })
    } else if (msg.type === 'event' && msg.id === 1) {
      if (first) {
        // A primeira mensagem traz todas as entidades: troca o mapa inteiro.
        first = false
        states.clear()
        applyEntitiesEvent(msg.event)
        connected = true
        broadcast('snapshot', snapshot())
        return
      }
      for (const [id, state] of applyEntitiesEvent(msg.event)) broadcast('state', { entity_id: id, state })
    }
  }
  // Conexão recusada (HA reiniciando) chega como "error", nem sempre seguida de "close": os dois reconectam.
  ws.onerror = () => {
    if (socket === ws) dropSocket('erro de conexão')
  }
  ws.onclose = () => {
    if (socket === ws) dropSocket('conexão fechada')
  }
}

// Cão de guarda (a cada 5 s). O "ping" do HA mantém lastActivity em dia; 45 s de silêncio (HA travado, cabo,
// VLAN trocada: nada disso fecha o TCP) derrubam o socket. E, se por qualquer motivo não houver socket nem
// tentativa agendada, reconecta.
setInterval(() => {
  if (!HA_URL || !HA_TOKEN || entityIds.length === 0) return
  if (!socket) {
    if (!reconnectTimer) connect()
    return
  }
  // Aperto de mão parado (conectou mas o HA não fala) cai em 10 s; conexão já autenticada, em 45 s.
  const limit = authenticated ? 45_000 : 10_000
  if (Date.now() - lastActivity > limit) {
    dropSocket(`sem resposta há ${limit / 1000} s`)
  } else if (authenticated && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ id: nextId++, type: 'ping' }))
  }
}, 5_000)

function reloadConfig() {
  const next = readWanted()
  if (next === null) return
  const signature = (w) => JSON.stringify([[...w.entities].sort(), [...w.history].sort(), [...w.statistics].sort(), [...w.weather].sort(), w.hours])
  if (signature(next) === signature(wanted) && entityIds.length > 0) return
  wanted = next
  entityIds = [...next.entities].sort()
  cache.clear()
  log(`Configuração lida: ${entityIds.length} entidades, ${next.history.size} em gráficos, ${next.statistics.size} em barras.`)
  connect()
}

/** Pergunta ao HA pelo WebSocket já autenticado. Rejeita se a conexão cair ou o HA devolver erro. */
function request(message, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    if (!socket || !authenticated || socket.readyState !== WebSocket.OPEN) return reject(new Error('sem conexão com o Home Assistant'))
    const id = nextId++
    const timer = setTimeout(() => {
      pendingRequests.delete(id)
      reject(new Error('Home Assistant não respondeu'))
    }, timeoutMs)
    pendingRequests.set(id, (msg) => {
      clearTimeout(timer)
      if (msg.success) resolve(msg.result)
      else reject(new Error(msg.error?.message ?? 'erro do Home Assistant'))
    })
    socket.send(JSON.stringify({ id, ...message }))
  })
}

async function cached(key, ttlMs, produce) {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < ttlMs) return hit.value
  const value = await produce()
  cache.set(key, { at: Date.now(), value })
  return value
}

/** Histórico numérico em médias de 5 min (24 h = 288 pontos por série): leve para o navegador do Pi. */
async function loadHistory() {
  const ids = [...wanted.history]
  if (ids.length === 0) return { hours: wanted.hours, series: {} }
  const end = new Date()
  const start = new Date(end.getTime() - wanted.hours * 3_600_000)
  const raw = await request({
    type: 'history/history_during_period',
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    entity_ids: ids,
    minimal_response: true,
    no_attributes: true,
    significant_changes_only: false,
    include_start_time_state: true,
  })
  const bucketMs = 300_000
  const series = {}
  for (const id of ids) {
    const buckets = new Map()
    for (const point of raw?.[id] ?? []) {
      const value = Number(point.s)
      if (point.s === '' || !Number.isFinite(value)) continue
      const at = Math.max(start.getTime(), (point.lu ?? point.lc) * 1000)
      const key = Math.floor(at / bucketMs) * bucketMs
      const bucket = buckets.get(key) ?? { sum: 0, n: 0 }
      bucket.sum += value
      bucket.n += 1
      buckets.set(key, bucket)
    }
    series[id] = [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([t, b]) => [t, Math.round((b.sum / b.n) * 100) / 100])
  }
  return { hours: wanted.hours, series }
}

/** Variação por hora nas últimas 48 h (ex.: kWh consumidos em cada hora a partir de um medidor acumulado). */
async function loadStatistics() {
  const ids = [...wanted.statistics]
  if (ids.length === 0) return { series: {} }
  const start = new Date(Date.now() - 48 * 3_600_000)
  start.setMinutes(0, 0, 0)
  const raw = await request({
    type: 'recorder/statistics_during_period',
    start_time: start.toISOString(),
    statistic_ids: ids,
    period: 'hour',
    types: ['change'],
  })
  const series = {}
  for (const id of ids) {
    series[id] = (raw?.[id] ?? []).filter((row) => Number.isFinite(row.change)).map((row) => [row.start, Math.round(row.change * 1000) / 1000])
  }
  return { series }
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0]
  if (req.method !== 'GET') {
    res.writeHead(405).end()
  } else if (path === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.write(`retry: 3000\nevent: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`)
    clients.add(res)
    req.on('close', () => clients.delete(res))
  } else if (path === '/states') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(snapshot()))
  } else if (path === '/history') {
    cached('history', 60_000, loadHistory).then((body) => sendJson(res, 200, body), (err) => sendJson(res, 503, { error: err.message, series: {} }))
  } else if (path === '/statistics') {
    cached('statistics', 300_000, loadStatistics).then((body) => sendJson(res, 200, body), (err) => sendJson(res, 503, { error: err.message, series: {} }))
  } else if (path === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify({ connected, entities: entityIds.length }))
  } else {
    res.writeHead(404).end()
  }
})

// Comentário periódico: mantém o SSE vivo através do nginx e detecta clientes mortos.
setInterval(() => {
  for (const res of clients) res.write(': ping\n\n')
}, 20_000)

server.listen(PORT, HOST, () => log(`Ponte do Home Assistant em http://${HOST}:${PORT}`))
reloadConfig()
watchFile(CONFIG_PATH, { interval: 5000 }, reloadConfig)

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(0))
