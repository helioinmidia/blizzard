import { Maximize, PanelLeft, Pause, Play, Settings } from 'lucide-react'
import type { HeaderTemperature as HeaderTemperatureConfig, View } from '../lib/config'
import { HeaderTemperature } from './HeaderTemperature'
import { useClock } from '../hooks/useClock'

interface Props {
  view: View | null
  subtitle: string
  temperature: HeaderTemperatureConfig | null
  rotating: boolean
  canRotate: boolean
  onToggleRotation: () => void
  sidebarOpen: boolean
  onToggleSidebar: () => void
  onOpenSettings: () => void
  onFullscreen: () => void
}

const timeFormatter = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' })
const dateFormatter = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })

export function TopBar({ view, subtitle, temperature, rotating, canRotate, onToggleRotation, sidebarOpen, onToggleSidebar, onOpenSettings, onFullscreen }: Props) {
  const now = useClock(1000)
  const date = dateFormatter.format(now)

  return (
    <header className="flex items-center justify-between gap-4 px-1.5">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onToggleSidebar}
          title="Mostrar/ocultar painel lateral (S)"
          aria-label="Mostrar ou ocultar painel lateral"
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-white/10 ${sidebarOpen ? 'text-ice-400' : 'text-frost-300'}`}
        >
          <PanelLeft className="h-4 w-4" />
        </button>
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-[26px] font-bold tracking-tight">{view?.name ?? 'Blizzard'}</span>
          <span className="truncate text-[13px] text-frost-500">{subtitle}</span>
        </div>
      </div>

      <div className="flex items-center gap-5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleRotation}
            disabled={!canRotate}
            title={canRotate ? 'Ligar/desligar rodízio (R)' : 'Configure rotationSeconds e ao menos duas visões'}
            className={`chip disabled:opacity-40 ${rotating ? 'bg-forest-500/20 text-forest-400' : 'hover:bg-white/15'}`}
          >
            {rotating ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
            Rodízio
          </button>
          <button type="button" onClick={onFullscreen} title="Tela cheia (F)" className="chip hover:bg-white/15">
            <Maximize className="h-3 w-3" />
            Tela cheia
          </button>
          <button type="button" onClick={onOpenSettings} title="Configuração (C)" className="chip hover:bg-white/15">
            <Settings className="h-3 w-3" />
            Configurar
          </button>
        </div>
        {temperature && <HeaderTemperature config={temperature} />}
        <div className="flex flex-col items-end leading-none">
          <span className="text-[40px] font-bold tracking-tight tabular-nums">{timeFormatter.format(now)}</span>
          <span className="mt-1 text-[13px] text-frost-500">{date.charAt(0).toUpperCase() + date.slice(1)}</span>
        </div>
      </div>
    </header>
  )
}
