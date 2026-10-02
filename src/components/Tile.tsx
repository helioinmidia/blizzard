import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Activity, Car, Maximize2, Minimize2, PawPrint, PersonStanding, type LucideIcon } from 'lucide-react'
import type { BlizzardConfig, Source } from '../lib/config'
import { DEFAULT_HA_BRIDGE_URL, findGroup } from '../lib/config'
import { haStore, latestDetection, timeAgo, type DetectionKind } from '../lib/ha'
import type { PlayerState } from '../lib/player'
import { useClock } from '../hooks/useClock'
import { VideoTile } from './VideoTile'
import { DashboardTile } from './DashboardTile'
import { HaTile } from './HaTile'
import { SourceBadge } from './SourceBadge'

interface Props {
  config: BlizzardConfig
  source: Source | null
  slotIndex: number
  focused: boolean
  onFocus: (slotIndex: number | null) => void
  onChangeSource: (slotIndex: number, sourceId: string | null) => void
}

type Resolution = { width: number; height: number }

/** Deslocamento das barras (letterbox) do vídeo dentro da célula; zero quando a proporção coincide ou é desconhecida. */
function videoFrame(cell: { width: number; height: number } | null, video: Resolution | null) {
  if (!cell || !video || cell.width === 0 || cell.height === 0) return { top: 0, right: 0 }
  const cellAspect = cell.width / cell.height
  const videoAspect = video.width / video.height
  if (cellAspect > videoAspect) {
    const shown = cell.height * videoAspect
    return { top: 0, right: (cell.width - shown) / 2 }
  }
  const shown = cell.width / videoAspect
  return { top: (cell.height - shown) / 2, right: 0 }
}

/** Faixa de resolução do que está tocando: Low (< 720p), High (720p a 1080p), Full (acima de 1080p). */
function ResolutionChip({ resolution }: { resolution: Resolution | null }) {
  if (!resolution) return null
  const tier = resolution.height > 1080 ? 'Full' : resolution.height >= 720 ? 'High' : 'Low'
  return (
    <span className="chip chip-solid" title={`${resolution.width}×${resolution.height}`}>
      {tier} · {resolution.height}p
    </span>
  )
}

function StatusChip({ source, state }: { source: Source; state: PlayerState }) {
  if (source.type !== 'camera') return <span className="chip chip-solid">Painel</span>
  if (state.status === 'playing') {
    return (
      <span className="chip chip-solid">
        <span className="h-1.5 w-1.5 rounded-full bg-forest-400" aria-hidden="true" />
        Ao vivo
      </span>
    )
  }
  if (state.status === 'error') {
    return (
      <span className="chip chip-solid">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden="true" />
        Sem sinal
      </span>
    )
  }
  return <span className="chip chip-solid">Conectando</span>
}

const detectionIcons: Record<DetectionKind, LucideIcon> = {
  motion: Activity,
  person: PersonStanding,
  vehicle: Car,
  animal: PawPrint,
  other: Activity,
}

/** Detecção com menos de 2 min ganha ícone em destaque, para chamar o olhar na TV. */
const RECENT_DETECTION_MS = 120_000

/** "14:32" no mesmo dia; "30/09 14:32" em dias anteriores. */
function detectionTime(at: number, now: number): string {
  const date = new Date(at)
  const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  if (date.toDateString() === new Date(now).toDateString()) return time
  return `${date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${time}`
}

/** Última detecção da câmera (movimento, pessoa, veículo…), lida do Home Assistant pela ponte. */
function MotionChip({ entities }: { entities: string[] }) {
  const store = haStore(DEFAULT_HA_BRIDGE_URL)
  const { status, states } = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const now = useClock(30_000).getTime()
  const detection = latestDetection(entities, states, now)
  if (!detection) return null
  const Icon = detectionIcons[detection.kind]
  const recent = now - detection.at < RECENT_DETECTION_MS
  const stale = status !== 'online'
  return (
    <span
      className={`chip chip-solid tabular-nums ${stale ? 'opacity-60' : ''}`}
      title={stale ? 'Home Assistant sem conexão; última detecção conhecida' : 'Última detecção'}
    >
      <Icon className={`h-3.5 w-3.5 ${recent ? 'text-amber-400' : 'text-ice-400'}`} aria-hidden="true" />
      {detection.label} · {detectionTime(detection.at, now)} · {timeAgo(detection.at, now)}
    </span>
  )
}

export function Tile({ config, source, slotIndex, focused, onFocus, onChangeSource }: Props) {
  const group = source ? findGroup(config, source.group) : null
  const [state, setState] = useState<PlayerState>({ status: 'idle', mode: '', error: null })
  const [resolution, setResolution] = useState<Resolution | null>(null)
  const onResolution = useCallback((next: Resolution | null) => setResolution(next), [])
  const cellRef = useRef<HTMLDivElement | null>(null)
  const [cellSize, setCellSize] = useState<{ width: number; height: number } | null>(null)

  useEffect(() => {
    const element = cellRef.current
    if (!element) return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect) setCellSize({ width: rect.width, height: rect.height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // Retângulo que o vídeo ocupa de fato na célula (object-fit: contain deixa barras quando a proporção difere).
  const frame = config.fit === 'contain' ? videoFrame(cellSize, resolution) : { top: 0, right: 0 }

  if (source === null) {
    return (
      <div className="group glass relative flex h-full w-full items-center justify-center rounded-[var(--radius-cell)] border-dashed text-sm text-frost-600">
        Célula vazia
        <SlotControls config={config} source={null} slotIndex={slotIndex} focused={focused} onFocus={onFocus} onChangeSource={onChangeSource} />
      </div>
    )
  }

  return (
    <div ref={cellRef} className="group cell relative h-full w-full overflow-hidden">
      <div className="h-full w-full">
        {source.type === 'camera' ? (
          <VideoTile
            go2rtcUrl={config.go2rtcUrl}
            stream={(focused || config.quality === 'hd') && source.hdStream ? source.hdStream : source.stream}
            playerMode={config.playerMode}
            fit={config.fit}
            onState={setState}
            onResolution={onResolution}
          />
        ) : source.type === 'ha' ? (
          <HaTile source={source} />
        ) : (
          <DashboardTile url={source.url} title={source.name} />
        )}
      </div>

      {/* Câmera: o nome é o carimbo nativo da própria câmera (canto superior esquerdo do vídeo); por cima, só os
          chips à direita: última detecção, resolução e estado. O corte do "cover" é ancorado no canto superior
          esquerdo para preservar o carimbo. */}
      {source.type === 'camera' && (
        <div
          className="pointer-events-none absolute flex items-center gap-1.5"
          style={{ top: frame.top + 12, right: frame.right + 12 }}
        >
          {source.motionEntities && <MotionChip entities={source.motionEntities} />}
          {state.status === 'playing' && <ResolutionChip resolution={resolution} />}
          <StatusChip source={source} state={state} />
        </div>
      )}
      {source.type !== 'camera' && (
        <div className="cell-shade-top pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-2 px-4 pt-3 pb-6">
          <span className="truncate text-[15px] font-bold text-frost-100 drop-shadow">{source.name}</span>
          <StatusChip source={source} state={state} />
        </div>
      )}
      {source.type !== 'camera' && (
        <div className="cell-shade-bottom pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-2 px-4 pt-6 pb-3 text-xs text-frost-300 transition-opacity group-hover:opacity-0">
          {group && <SourceBadge kind={group.kind} />}
          <span className="truncate">{source.type === 'ha' ? `${source.cards.length} ${source.cards.length === 1 ? 'cartão' : 'cartões'}` : new URL(source.url, window.location.href).host}</span>
        </div>
      )}

      <SlotControls config={config} source={source} slotIndex={slotIndex} focused={focused} onFocus={onFocus} onChangeSource={onChangeSource} />
    </div>
  )
}

function SlotControls({ config, source, slotIndex, focused, onFocus, onChangeSource }: Props) {
  return (
    <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 px-3 pb-3 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
      <select
        aria-label="Trocar fonte desta célula"
        value={source?.id ?? ''}
        onChange={(e) => onChangeSource(slotIndex, e.target.value || null)}
        className="glass min-w-0 flex-1 rounded-full px-3 py-1.5 text-xs text-frost-100 outline-none"
      >
        <option value="">(vazio)</option>
        {config.groups.map((g) => (
          <optgroup key={g.id} label={g.name}>
            {config.sources
              .filter((s) => s.group === g.id)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
      <button
        type="button"
        onClick={() => onFocus(focused ? null : slotIndex)}
        title={focused ? 'Voltar à grade (Esc)' : 'Ampliar'}
        aria-label={focused ? 'Voltar à grade' : 'Ampliar'}
        className="glass flex h-8 w-8 items-center justify-center rounded-full text-frost-100 hover:bg-white/15"
      >
        {focused ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
      </button>
    </div>
  )
}
