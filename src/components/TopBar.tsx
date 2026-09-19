import { Maximize, PanelLeft, Pause, Play, Settings, Wifi, WifiOff } from 'lucide-react'
import type { Go2rtcStatus } from '../lib/go2rtc'
import type { View } from '../lib/config'
import { formatClock, formatShortDate } from '../lib/format'
import { useClock } from '../hooks/useClock'

interface Props {
  views: View[]
  activeViewId: string | null
  onSelectView: (id: string) => void
  rotating: boolean
  rotationSeconds: number
  onToggleRotation: () => void
  status: Go2rtcStatus | null
  sidebarOpen: boolean
  onToggleSidebar: () => void
  onOpenSettings: () => void
  onFullscreen: () => void
}

export function TopBar({
  views,
  activeViewId,
  onSelectView,
  rotating,
  rotationSeconds,
  onToggleRotation,
  status,
  sidebarOpen,
  onToggleSidebar,
  onOpenSettings,
  onFullscreen,
}: Props) {
  const now = useClock()
  const canRotate = rotationSeconds > 0 && views.length > 1

  return (
    <header className="flex h-11 items-center gap-3 border-b border-ink-700 bg-ink-900 px-3">
      <button
        type="button"
        onClick={onToggleSidebar}
        title="Mostrar/ocultar painel lateral (S)"
        className={`rounded p-1.5 hover:bg-ink-700 ${sidebarOpen ? 'text-ice-400' : 'text-frost-300'}`}
      >
        <PanelLeft className="h-4 w-4" />
      </button>

      <div className="flex items-center gap-2">
        <img src="/blizzard.svg" alt="" className="h-6 w-6" />
        <span className="text-sm font-bold tracking-[0.2em] text-frost-100">BLIZZARD</span>
        <span className="hidden text-xs text-frost-500 sm:inline">Central de Monitoramento</span>
      </div>

      <nav className="ml-4 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {views.map((view, index) => (
          <button
            key={view.id}
            type="button"
            onClick={() => onSelectView(view.id)}
            title={`Visão ${index + 1} (tecla ${index + 1})`}
            className={`shrink-0 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              view.id === activeViewId ? 'bg-ice-500/20 text-ice-400' : 'text-frost-300 hover:bg-ink-700'
            }`}
          >
            <span className="mr-1.5 font-mono text-[10px] text-frost-500">{index + 1}</span>
            {view.name}
          </button>
        ))}
      </nav>

      <button
        type="button"
        onClick={onToggleRotation}
        disabled={!canRotate}
        title={canRotate ? `Rodízio a cada ${rotationSeconds}s (R)` : 'Configure rotationSeconds e ao menos duas visões'}
        className={`flex items-center gap-1 rounded px-2 py-1 text-xs disabled:opacity-40 ${
          rotating ? 'bg-forest-500/20 text-forest-400' : 'text-frost-300 hover:bg-ink-700'
        }`}
      >
        {rotating ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        Rodízio
      </button>

      <div
        className="flex items-center gap-1.5 text-xs"
        title={status?.reachable ? `${status.streams.length} streams no go2rtc` : 'go2rtc inacessível'}
      >
        {status === null ? (
          <Wifi className="h-4 w-4 text-frost-500" />
        ) : status.reachable ? (
          <Wifi className="h-4 w-4 text-forest-400" />
        ) : (
          <WifiOff className="h-4 w-4 text-red-400" />
        )}
        <span className="hidden text-frost-300 md:inline">go2rtc</span>
      </div>

      <div className="flex items-baseline gap-2 font-mono">
        <span className="text-sm text-frost-100">{formatClock(now)}</span>
        <span className="hidden text-[11px] text-frost-500 md:inline">{formatShortDate(now)}</span>
      </div>

      <button type="button" onClick={onFullscreen} title="Tela cheia (F)" className="rounded p-1.5 text-frost-300 hover:bg-ink-700">
        <Maximize className="h-4 w-4" />
      </button>
      <button type="button" onClick={onOpenSettings} title="Configuração (C)" className="rounded p-1.5 text-frost-300 hover:bg-ink-700">
        <Settings className="h-4 w-4" />
      </button>
    </header>
  )
}
