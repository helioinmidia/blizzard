import { AlertTriangle, Camera, LayoutDashboard } from 'lucide-react'
import type { BlizzardConfig } from '../lib/config'
import type { Go2rtcStatus } from '../lib/go2rtc'
import { SourceBadge } from './SourceBadge'

interface Props {
  config: BlizzardConfig
  status: Go2rtcStatus | null
  onPickSource: (sourceId: string) => void
}

export function Sidebar({ config, status, onPickSource }: Props) {
  const known = new Set(status?.streams ?? [])

  return (
    <aside className="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-ink-700 bg-ink-900">
      <div className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-frost-500">Fontes</div>
      {config.groups.length === 0 && (
        <p className="px-3 py-2 text-xs text-frost-500">Nenhuma fonte configurada. Abra a configuração (C).</p>
      )}
      {config.groups.map((group) => {
        const sources = config.sources.filter((s) => s.group === group.id)
        return (
          <section key={group.id} className="mb-2">
            <div className="flex items-center gap-2 px-3 py-1.5">
              <SourceBadge kind={group.kind} />
              <span className="truncate text-xs font-medium text-frost-100">{group.name}</span>
            </div>
            <ul>
              {sources.map((source) => {
                const missing = source.type === 'camera' && status?.reachable && !known.has(source.stream)
                return (
                  <li key={source.id}>
                    <button
                      type="button"
                      onClick={() => onPickSource(source.id)}
                      title={missing ? `Stream "${source.stream}" não existe no go2rtc` : 'Ampliar esta fonte'}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-frost-300 hover:bg-ink-700 hover:text-frost-100"
                    >
                      {source.type === 'camera' ? (
                        <Camera className="h-3.5 w-3.5 shrink-0 text-frost-500" />
                      ) : (
                        <LayoutDashboard className="h-3.5 w-3.5 shrink-0 text-frost-500" />
                      )}
                      <span className="truncate">{source.name}</span>
                      {missing && <AlertTriangle className="ml-auto h-3.5 w-3.5 shrink-0 text-amber-400" />}
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}

      <div className="mt-auto border-t border-ink-700 p-3 text-[11px] leading-5 text-frost-500">
        <div className="mb-1 font-semibold uppercase tracking-wider">Atalhos</div>
        <div><kbd className="font-mono text-frost-300">1–9</kbd> visões · <kbd className="font-mono text-frost-300">R</kbd> rodízio</div>
        <div><kbd className="font-mono text-frost-300">F</kbd> tela cheia · <kbd className="font-mono text-frost-300">S</kbd> painel</div>
        <div><kbd className="font-mono text-frost-300">C</kbd> configuração · <kbd className="font-mono text-frost-300">Esc</kbd> voltar</div>
      </div>
    </aside>
  )
}
