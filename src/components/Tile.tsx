import { Maximize2, Minimize2 } from 'lucide-react'
import type { BlizzardConfig, Source } from '../lib/config'
import { findGroup } from '../lib/config'
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

export function Tile({ config, source, slotIndex, focused, onFocus, onChangeSource }: Props) {
  const group = source ? findGroup(config, source.group) : null

  return (
    <div className="group relative flex h-full w-full flex-col overflow-hidden rounded-md border border-ink-700 bg-ink-900">
      <div className="flex-1 overflow-hidden">
        {source === null ? (
          <div className="flex h-full items-center justify-center text-xs text-frost-500">Célula vazia</div>
        ) : source.type === 'camera' ? (
          <VideoTile
            go2rtcUrl={config.go2rtcUrl}
            stream={focused && source.hdStream ? source.hdStream : source.stream}
            playerMode={config.playerMode}
          />
        ) : source.type === 'ha' ? (
          <HaTile source={source} />
        ) : (
          <DashboardTile url={source.url} title={source.name} />
        )}
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2 bg-gradient-to-b from-black/70 to-transparent px-2 py-1.5">
        {group && <SourceBadge kind={group.kind} />}
        <span className="truncate text-xs font-medium text-frost-100 drop-shadow">{source?.name ?? '—'}</span>
      </div>

      <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <select
          aria-label="Trocar fonte desta célula"
          value={source?.id ?? ''}
          onChange={(e) => onChangeSource(slotIndex, e.target.value || null)}
          className="min-w-0 flex-1 rounded border border-ink-600 bg-ink-800 px-1.5 py-1 text-xs text-frost-100"
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
          className="rounded border border-ink-600 bg-ink-800 p-1 text-frost-100 hover:bg-ink-700"
        >
          {focused ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
      </div>
    </div>
  )
}
