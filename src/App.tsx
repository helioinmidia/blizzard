import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CloudOff } from 'lucide-react'
import {
  describeError,
  emptyConfig,
  loadConfig,
  saveConfig,
  serializeConfig,
  type BlizzardConfig,
  type LoadedConfig,
  type View,
} from './lib/config'
import { useGo2rtcStatus } from './hooks/useGo2rtcStatus'
import { useIdle } from './hooks/useIdle'
import { TopBar } from './components/TopBar'
import { Sidebar } from './components/Sidebar'
import { Wall } from './components/Wall'
import { SettingsDialog } from './components/SettingsDialog'
import { BrandMark } from './components/BrandMark'
import './lib/player'

/** Sem mouse/teclado por este tempo, o cursor some (a interface fica, como no desenho da TV). */
const IDLE_CURSOR_MS = 15_000
/** Intervalo em que cada tela confere se a configuração mudou no servidor. */
const CONFIG_POLL_MS = 10_000
const SPOTLIGHT_VIEW_ID = '__spotlight'

export default function App() {
  const [loaded, setLoaded] = useState<LoadedConfig>({ config: emptyConfig, origin: 'empty', error: null })
  // Parâmetros por tela, na URL (a configuração é compartilhada entre TV e laptop, estes não):
  //   ?view=<id>   abre direto numa visão (uma segunda TV, ou um link para a visão do Home Assistant)
  //   ?sidebar=0   começa sem o painel lateral (mais espaço para as células na TV)
  //   ?scale=1.25  amplia toda a interface (texto e chips) para leitura à distância
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const uiScale = useMemo(() => {
    const value = Number.parseFloat(params.get('scale') ?? '1')
    return Number.isFinite(value) ? Math.min(2, Math.max(0.75, value)) : 1
  }, [params])
  const [activeViewId, setActiveViewId] = useState<string | null>(() => params.get('view'))
  /** Fonte ampliada a partir do painel lateral; não faz parte da configuração salva. */
  const [spotlightSource, setSpotlightSource] = useState<string | null>(null)
  const [focusedSlot, setFocusedSlot] = useState<number | null>(null)
  const [rotating, setRotating] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(() => !['0', 'false', 'no'].includes((params.get('sidebar') ?? '1').toLowerCase()))
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const settingsOpenRef = useRef(false)
  useEffect(() => {
    settingsOpenRef.current = settingsOpen
  }, [settingsOpen])

  const applyConfig = useCallback((config: BlizzardConfig, origin: LoadedConfig['origin']) => {
    setLoaded({ config, origin, error: null })
    setActiveViewId((current) => (current && config.views.some((v) => v.id === current) ? current : config.views[0]?.id ?? null))
    setSpotlightSource(null)
    setFocusedSlot(null)
    setRotating((r) => r && config.rotationSeconds > 0 && config.views.length > 1)
  }, [])

  const reload = useCallback(async () => {
    const result = await loadConfig()
    if (result.error) {
      setLoaded(result)
      setSidebarOpen(true)
      return
    }
    applyConfig(result.config, result.origin)
    setRotating(result.config.rotationSeconds > 0 && result.config.views.length > 1)
  }, [applyConfig])

  useEffect(() => {
    const id = window.setTimeout(() => void reload(), 0)
    return () => window.clearTimeout(id)
  }, [reload])

  const { config } = loaded
  const status = useGo2rtcStatus(config.go2rtcUrl)
  const idle = useIdle(IDLE_CURSOR_MS)

  // Outras telas (laptop, TV) podem ter salvo: sincroniza sem recarregar a página.
  const serialized = useMemo(() => serializeConfig(config), [config])
  useEffect(() => {
    if (loaded.origin !== 'api') return
    let cancelled = false
    const id = window.setInterval(() => {
      if (settingsOpenRef.current) return
      void loadConfig().then((result) => {
        if (cancelled || result.error || result.origin !== 'api') return
        if (serializeConfig(result.config) !== serialized) applyConfig(result.config, 'api')
      })
    }, CONFIG_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [loaded.origin, serialized, applyConfig])

  const persist = useCallback(async (next: BlizzardConfig) => {
    setLoaded((current) => ({ ...current, config: next }))
    setSaveError(null)
    try {
      const saved = await saveConfig(next)
      setLoaded((current) => ({ ...current, config: saved, origin: 'api', error: null }))
    } catch (err) {
      setSaveError(describeError(err))
    }
  }, [])

  const views = config.views
  const activeView: View | null = useMemo(() => {
    if (spotlightSource) {
      return { id: SPOTLIGHT_VIEW_ID, name: 'Destaque', columns: 1, rows: 1, slots: [spotlightSource] }
    }
    return views.find((v) => v.id === activeViewId) ?? null
  }, [views, activeViewId, spotlightSource])

  // Rodízio automático de visões.
  useEffect(() => {
    if (!rotating || config.rotationSeconds <= 0 || views.length < 2 || focusedSlot !== null || spotlightSource) return
    const id = window.setInterval(() => {
      setActiveViewId((current) => {
        const index = views.findIndex((v) => v.id === current)
        return views[(index + 1) % views.length]?.id ?? current
      })
    }, config.rotationSeconds * 1000)
    return () => window.clearInterval(id)
  }, [rotating, config.rotationSeconds, views, focusedSlot, spotlightSource])

  const selectView = useCallback((id: string) => {
    setActiveViewId(id)
    setSpotlightSource(null)
    setFocusedSlot(null)
  }, [])

  // Troca de fonte numa célula: altera a visão e grava no servidor.
  const changeSlot = useCallback(
    (slotIndex: number, sourceId: string | null) => {
      if (spotlightSource) {
        setSpotlightSource(sourceId)
        return
      }
      const next: BlizzardConfig = {
        ...config,
        views: config.views.map((view) => {
          if (view.id !== activeViewId) return view
          const slots = view.slots.slice()
          slots[slotIndex] = sourceId
          return { ...view, slots }
        }),
      }
      void persist(next)
    },
    [config, activeViewId, spotlightSource, persist],
  )

  const pickSource = useCallback((sourceId: string) => {
    setSpotlightSource(sourceId)
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
          setSpotlightSource(null)
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

  const subtitle = useMemo(() => {
    if (!activeView) return 'Nenhuma visão configurada'
    const sources = activeView.slots.map((id) => config.sources.find((s) => s.id === id)).filter((s) => s !== undefined)
    const cameras = sources.filter((s) => s.type === 'camera').length
    const panels = sources.filter((s) => s.type === 'dashboard').length
    const empty = activeView.slots.length - sources.length
    const parts = [`${cameras} ${cameras === 1 ? 'câmera' : 'câmeras'}`]
    if (panels) parts.push(`${panels} ${panels === 1 ? 'painel' : 'painéis'}`)
    if (empty) parts.push(`${empty} ${empty === 1 ? 'célula vazia' : 'células vazias'}`)
    return `${parts.join(' · ')} · ${activeView.columns}×${activeView.rows}`
  }, [activeView, config.sources])

  const canRotate = config.rotationSeconds > 0 && views.length > 1

  return (
    <div className={`flex h-full gap-4 p-5 ${idle && !settingsOpen ? 'cursor-none' : ''}`} style={{ zoom: uiScale }}>
      {sidebarOpen && (
        <Sidebar
          config={config}
          views={views}
          activeViewId={spotlightSource ? null : activeViewId}
          onSelectView={selectView}
          status={status}
          rotating={rotating}
          configOrigin={loaded.origin}
          onPickSource={pickSource}
        />
      )}

      <section className="flex min-w-0 flex-1 flex-col gap-3.5">
        <TopBar
          view={activeView}
          subtitle={subtitle}
          temperature={config.temperature}
          rotating={rotating}
          canRotate={canRotate}
          onToggleRotation={() => setRotating((r) => !r)}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((o) => !o)}
          onOpenSettings={() => setSettingsOpen(true)}
          onFullscreen={toggleFullscreen}
        />

        {loaded.error && (
          <div className="glass flex items-center gap-2 rounded-2xl px-4 py-2 text-xs text-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
            <span className="truncate">Configuração inválida: {loaded.error}</span>
            <button type="button" onClick={() => setSettingsOpen(true)} className="ml-auto shrink-0 underline">
              Corrigir
            </button>
          </div>
        )}
        {saveError && (
          <div className="glass flex items-center gap-2 rounded-2xl px-4 py-2 text-xs text-red-200">
            <CloudOff className="h-4 w-4 shrink-0 text-red-400" />
            <span className="truncate">{saveError}</span>
            <button type="button" onClick={() => void reload()} className="ml-auto shrink-0 underline">
              Recarregar do servidor
            </button>
          </div>
        )}
        {!loaded.error && loaded.origin === 'file' && (
          <div className="glass flex items-center gap-2 rounded-2xl px-4 py-1.5 text-[11px] text-frost-500">
            <CloudOff className="h-3.5 w-3.5 shrink-0" />
            Servidor de configuração indisponível: alterações não serão salvas.
          </div>
        )}

        <main className="min-h-0 flex-1">
          {activeView ? (
            <Wall config={config} view={activeView} focusedSlot={focusedSlot} onFocus={setFocusedSlot} onChangeSource={changeSlot} />
          ) : (
            <div className="glass flex h-full flex-col items-center justify-center gap-3 rounded-3xl text-center">
              <BrandMark className="h-16 w-16" />
              <h1 className="text-lg font-bold tracking-[0.25em] text-frost-100">BLIZZARD</h1>
              <p className="max-w-md text-sm text-frost-500">
                Nenhuma visão configurada. Edite <code className="font-mono text-frost-300">public/config/blizzard.config.json</code> no
                servidor ou abra a configuração (tecla <kbd className="font-mono text-frost-300">C</kbd>).
              </p>
            </div>
          )}
        </main>
      </section>

      {settingsOpen && (
        <SettingsDialog
          loaded={loaded}
          onSave={async (next) => {
            const saved = await saveConfig(next)
            applyConfig(saved, 'api')
            setSaveError(null)
          }}
          onReload={reload}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  )
}
