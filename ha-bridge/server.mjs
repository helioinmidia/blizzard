// Blizzard · ponte do Home Assistant
//
// Mantém o token do HA no servidor e entrega ao navegador, por SSE, somente os estados das entidades
// citadas nas fontes "ha" do blizzard.config.json. É somente leitura: não há rota que chame serviços.
//
//   GET /states  → { connected, states }            (foto atual)
//   GET /events  → SSE: "snapshot", "state", "status" (tempo real)
//   GET /health  → { connected, entities }
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
let connected = false
let socket = null
let reconnectTimer = null
let reconnectDelay = 1000

function readEntityIds() {
  try {
    const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
    const ids = new Set()
    for (const source of config.sources ?? []) {
      if (source?.type !== 'ha') continue
      for (const card of source.cards ?? []) {
        for (const item of card?.entities ?? []) {
          const id = typeof item === 'string' ? item : item?.entity
          if (typeof id === 'string' && /^[a-z_]+\.[a-z0-9_]+$/.test(id)) ids.add(id)
        }
      }
    }
    return [...ids].sort()
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
  return { connected, states: Object.fromEntries(states) }
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

function connect() {
  if (!HA_URL || !HA_TOKEN) return
  if (socket) {
    socket.onclose = null
    socket.close()
    socket = null
  }
  if (entityIds.length === 0) {
    log('Nenhuma entidade configurada em fontes "ha"; aguardando mudança na configuração.')
    states.clear()
    setConnected(false)
    return
  }

  const ws = new WebSocket(`${HA_URL.replace(/^http/, 'ws')}/api/websocket`)
  socket = ws
  let first = true

  ws.onmessage = (message) => {
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
      ws.close()
    } else if (msg.type === 'auth_ok') {
      log(`Conectado ao Home Assistant ${msg.ha_version ?? ''}; acompanhando ${entityIds.length} entidades.`)
      reconnectDelay = 1000
      ws.send(JSON.stringify({ id: 1, type: 'subscribe_entities', entity_ids: entityIds }))
    } else if (msg.type === 'result' && msg.success === false) {
      log(`Home Assistant devolveu erro: ${msg.error?.message ?? 'desconhecido'}`)
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
  ws.onerror = () => {}
  ws.onclose = () => {
    if (socket !== ws) return
    socket = null
    if (connected) log('Conexão com o Home Assistant caiu; tentando de novo.')
    setConnected(false)
    scheduleReconnect()
  }
}

function reloadConfig() {
  const ids = readEntityIds()
  if (ids === null || ids.join() === entityIds.join()) return
  entityIds = ids
  log(`Configuração lida: ${ids.length} entidades.`)
  connect()
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
