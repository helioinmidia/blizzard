import { useState } from 'react'
import { Maximize2, Minimize2 } from 'lucide-react'
import type { BlizzardConfig, Source } from '../lib/config'
import { findGroup } from '../lib/config'
import type { PlayerState } from '../lib/player'
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

function StatusChip({ source, state }: { source: Source; state: PlayerState }) {
  if (source.type !== 'camera') return <span className="chip bg-amber-500/15 text-amber-200">Painel</span>
  if (state.status === 'playing') return <span className="chip bg-forest-500/20 text-forest-400">Ao vivo</span>
  if (state.status === 'error') return <span className="chip bg-amber-500/20 text-amber-300">Sem sinal</span>
  return <span className="chip text-frost-300">Conectando</span>
}

export function Tile({ config, source, slotIndex, focused, onFocus, onChangeSource }: Props) {
  const group = source ? findGroup(config, source.group) : null
  const [state, setState] = useState<PlayerState>({ status: 'idle', mode: '', error: null })

  if (source === null) {
    return (
      <div className="group glass relative flex h-full w-full items-center justify-center rounded-[var(--radius-cell)] border-dashed text-sm text-frost-600">
        Célula vazia
        <SlotControls config={config} source={null} slotIndex={slotIndex} focused={focused} onFocus={onFocus} onChangeSource={onChangeSource} />
      </div>
    )
  }

  return (
    <div className="group cell relative h-full w-full overflow-hidden">
      <div className="h-full w-full">
        {source.type === 'camera' ? (
          <VideoTile
            go2rtcUrl={config.go2rtcUrl}
            stream={focused && source.hdStream ? source.hdStream : source.stream}
            playerMode={config.playerMode}
            onState={setState}
          />
        ) : source.type === 'ha' ? (
          <HaTile source={source} />
        ) : (
          <DashboardTile url={source.url} title={source.name} />
        )}
      </div>

      <div className="cell-shade-top pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-2 px-4 pt-3 pb-6">
        <span className="truncate text-[15px] font-bold text-frost-100 drop-shadow">{source.name}</span>
        <StatusChip source={source} state={state} />
      </div>

      <div className="cell-shade-bottom pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 px-4 pt-6 pb-3 text-xs text-frost-300 transition-opacity group-hover:opacity-0">
        <span className="flex items-center gap-2 truncate">
          {group && <SourceBadge kind={group.kind} />}
          <span className="truncate">{source.type === 'camera' ? source.stream : source.type === 'ha' ? `${source.cards.length} ${source.cards.length === 1 ? 'cartão' : 'cartões'}` : new URL(source.url, window.location.href).host}</span>
        </span>
        {state.status === 'playing' && <span className="font-semibold">{state.mode}</span>}
      </div>

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
