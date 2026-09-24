import { Camera, LayoutDashboard } from 'lucide-react'
import type { BlizzardConfig, View } from '../lib/config'
import type { Go2rtcStatus } from '../lib/go2rtc'

interface Props {
  config: BlizzardConfig
  views: View[]
  activeViewId: string | null
  onSelectView: (id: string) => void
  status: Go2rtcStatus | null
  rotating: boolean
  configOrigin: 'api' | 'file' | 'empty'
  onPickSource: (sourceId: string) => void
}

export function Sidebar({ config, views, activeViewId, onSelectView, status, rotating, configOrigin, onPickSource }: Props) {
  const known = new Set(status?.streams ?? [])

  return (
    <aside className="glass flex w-[268px] shrink-0 flex-col gap-5 rounded-3xl p-4">
      <div className="flex items-center gap-3 px-1.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-ice-400 to-ice-500">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#052033" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M12 2v20M3 7l18 10M3 17l18-10" />
          </svg>
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-base font-bold tracking-wide">Blizzard</span>
          <span className="text-[11px] text-frost-500">{window.location.host}</span>
        </div>
      </div>

      <nav className="flex flex-col gap-1">
        <span className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-frost-600">Visões</span>
        {views.length === 0 && <span className="px-3 text-xs text-frost-500">Nenhuma visão configurada.</span>}
        {views.map((view, index) => {
          const active = view.id === activeViewId
          return (
            <button
              key={view.id}
              type="button"
              onClick={() => onSelectView(view.id)}
              title={`Visão ${index + 1} (tecla ${index + 1})`}
              className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
                active ? 'bg-ice-400/15 font-semibold text-frost-100' : 'text-frost-300 hover:bg-white/5'
              }`}
            >
              <span className={`w-5 text-center text-xs ${active ? 'text-ice-400' : 'text-frost-600'}`}>{index + 1}</span>
              <span className="truncate">{view.name}</span>
            </button>
          )
        })}
      </nav>

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        <span className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-frost-600">Fontes</span>
        {config.sources.length === 0 && <span className="px-3 text-xs text-frost-500">Nenhuma fonte configurada. Abra a configuração (C).</span>}
        {config.groups.map((group) =>
          config.sources
            .filter((s) => s.group === group.id)
            .map((source) => {
              const missing = source.type === 'camera' && status?.reachable && !known.has(source.stream)
              const dot = source.type === 'dashboard' ? 'bg-amber-400' : missing ? 'bg-amber-400' : 'bg-forest-400'
              return (
                <button
                  key={source.id}
                  type="button"
                  onClick={() => onPickSource(source.id)}
                  title={missing ? `Stream "${source.stream}" não existe no go2rtc` : `${group.name} · ampliar`}
                  className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-frost-300 hover:bg-white/5 hover:text-frost-100"
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
                  {source.type === 'camera' ? (
                    <Camera className="h-3.5 w-3.5 shrink-0 text-frost-600" />
                  ) : (
                    <LayoutDashboard className="h-3.5 w-3.5 shrink-0 text-frost-600" />
                  )}
                  <span className="truncate">{source.name}</span>
                  <span className="ml-auto truncate text-[11px] text-frost-600">{group.name}</span>
                </button>
              )
            }),
        )}
      </div>

      <div className="flex shrink-0 flex-col gap-1.5 rounded-2xl bg-white/5 p-3 text-xs text-frost-500">
        <div className="flex justify-between">
          <span>go2rtc</span>
          <span className={status === null ? '' : status.reachable ? 'text-forest-400' : 'text-amber-400'}>
            {status === null ? '…' : status.reachable ? `online · ${status.streams.length} streams` : 'inacessível'}
          </span>
        </div>
        <div className="flex justify-between">
          <span>Configuração</span>
          <span>{configOrigin === 'api' ? 'servidor' : configOrigin === 'file' ? 'somente leitura' : '—'}</span>
        </div>
        <div className="flex justify-between">
          <span>Rodízio</span>
          <span>{rotating ? `a cada ${config.rotationSeconds} s` : 'pausado'}</span>
        </div>
        <div className="mt-1 border-t border-white/10 pt-2 text-[11px] leading-5 text-frost-600">
          <kbd className="text-frost-300">1–9</kbd> visões · <kbd className="text-frost-300">R</kbd> rodízio · <kbd className="text-frost-300">F</kbd> tela cheia
          <br />
          <kbd className="text-frost-300">S</kbd> painel · <kbd className="text-frost-300">C</kbd> configuração · <kbd className="text-frost-300">Esc</kbd> voltar
        </div>
      </div>
    </aside>
  )
}
