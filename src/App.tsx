import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { emptyConfig, loadConfig, type BlizzardConfig, type LoadedConfig, type View } from './lib/config'
import { useGo2rtcStatus } from './hooks/useGo2rtcStatus'
import { useIdle } from './hooks/useIdle'
import { TopBar } from './components/TopBar'
import { Sidebar } from './components/Sidebar'
import { Wall } from './components/Wall'
import { SettingsDialog } from './components/SettingsDialog'
import './lib/player'

const IDLE_HIDE_MS = 15_000

export default function App() {
  const [loaded, setLoaded] = useState<LoadedConfig>({ config: emptyConfig, origin: 'empty', error: null })
  // Visões editadas ao vivo (troca de fonte numa célula) sem alterar a configuração salva.
  const [views, setViews] = useState<View[]>([])
  const [activeViewId, setActiveViewId] = useState<string | null>(null)
  const [focusedSlot, setFocusedSlot] = useState<number | null>(null)
  const [rotating, setRotating] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const applyConfig = useCallback((config: BlizzardConfig, origin: LoadedConfig['origin']) => {
    setLoaded({ config, origin, error: null })
    setViews(config.views)
    setActiveViewId(config.views[0]?.id ?? null)
    setFocusedSlot(null)
    setRotating(config.rotationSeconds > 0 && config.views.length > 1)
  }, [])

  useEffect(() => {
    void loadConfig().then((result) => {
      if (result.error) {
        setLoaded(result)
        setSidebarOpen(true)
        return
      }
      applyConfig(result.config, result.origin)
    })
  }, [applyConfig])

  const { config } = loaded
  const status = useGo2rtcStatus(config.go2rtcUrl)
  const idle = useIdle(IDLE_HIDE_MS)
  const activeView = useMemo(() => views.find((v) => v.id === activeViewId) ?? null, [views, activeViewId])

  // Rodízio automático de visões.
  useEffect(() => {
    if (!rotating || config.rotationSeconds <= 0 || views.length < 2 || focusedSlot !== null) return
    const id = window.setInterval(() => {
      setActiveViewId((current) => {
        const index = views.findIndex((v) => v.id === current)
        return views[(index + 1) % views.length]?.id ?? current
      })
    }, config.rotationSeconds * 1000)
    return () => window.clearInterval(id)
  }, [rotating, config.rotationSeconds, views, focusedSlot])

  const selectView = useCallback((id: string) => {
    setActiveViewId(id)
    setFocusedSlot(null)
  }, [])

  const changeSlot = useCallback((slotIndex: number, sourceId: string | null) => {
    setViews((current) =>
      current.map((view) => {
        if (view.id !== activeViewId) return view
        const slots = view.slots.slice()
        slots[slotIndex] = sourceId
        return { ...view, slots }
      }),
    )
  }, [activeViewId])

  // Painel lateral: amplia a fonte numa visão temporária de célula única.
  const pickSource = useCallback((sourceId: string) => {
    setViews((current) => {
      const spotlightId = '__spotlight'
      const spotlight: View = { id: spotlightId, name: 'Destaque', columns: 1, rows: 1, slots: [sourceId] }
      const rest = current.filter((v) => v.id !== spotlightId)
      return [...rest, spotlight]
    })
    setActiveViewId('__spotlight')
    setFocusedSlot(null)
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void document.documentElement.requestFullscreen().catch(() => undefined)
  }, [])

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if (settingsOpen) {
        if (ev.key === 'Escape') setSettingsOpen(false)
        return
      }
      const digit = Number.parseInt(ev.key, 10)
      if (digit >= 1 && digit <= 9 && views[digit - 1]) {
        selectView(views[digit - 1].id)
        return
      }
      switch (ev.key.toLowerCase()) {
        case 'escape':
          setFocusedSlot(null)
          break
        case 'r':
          setRotating((r) => !r)
          break
        case 'f':
          toggleFullscreen()
          break
        case 's':
          setSidebarOpen((open) => !open)
          break
        case 'c':
          setSettingsOpen(true)
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [views, settingsOpen, selectView, toggleFullscreen])

  const chromeHidden = idle && !settingsOpen
  const configuredViews = views.filter((v) => v.id !== '__spotlight')

  return (
    <div className={`flex h-full flex-col bg-ink-950 ${chromeHidden ? 'cursor-none' : ''}`}>
      <div className={`transition-all duration-300 ${chromeHidden ? '-mt-11 opacity-0' : ''}`}>
        <TopBar
          views={configuredViews}
          activeViewId={activeViewId}
          onSelectView={selectView}
          rotating={rotating}
          rotationSeconds={config.rotationSeconds}
          onToggleRotation={() => setRotating((r) => !r)}
          status={status}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((o) => !o)}
          onOpenSettings={() => setSettingsOpen(true)}
          onFullscreen={toggleFullscreen}
        />
      </div>

      {loaded.error && (
        <div className="flex items-center gap-2 border-b border-amber-900/60 bg-amber-950/40 px-3 py-1.5 text-xs text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="truncate">Configuração inválida: {loaded.error}</span>
          <button type="button" onClick={() => setSettingsOpen(true)} className="ml-auto shrink-0 underline">
            Corrigir
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {sidebarOpen && !chromeHidden && <Sidebar config={config} status={status} onPickSource={pickSource} />}
        <main className="min-w-0 flex-1">
          {activeView ? (
            <Wall config={config} view={activeView} focusedSlot={focusedSlot} onFocus={setFocusedSlot} onChangeSource={changeSlot} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <img src="/blizzard.svg" alt="" className="h-16 w-16 opacity-80" />
              <h1 className="text-lg font-semibold tracking-[0.25em] text-frost-100">BLIZZARD</h1>
              <p className="max-w-md text-sm text-frost-500">
                Nenhuma visão configurada. Edite <code className="font-mono text-frost-300">public/config/blizzard.config.json</code> no
                servidor ou abra a configuração (tecla <kbd className="font-mono text-frost-300">C</kbd>).
              </p>
            </div>
          )}
        </main>
      </div>

      {settingsOpen && <SettingsDialog loaded={loaded} onApply={applyConfig} onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
