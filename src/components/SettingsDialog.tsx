import { useState } from 'react'
import { Download, RefreshCw, Save, X } from 'lucide-react'
import { describeError, parseConfig, type BlizzardConfig, type LoadedConfig } from '../lib/config'

interface Props {
  loaded: LoadedConfig
  onSave: (config: BlizzardConfig) => Promise<void>
  onReload: () => Promise<void>
  onClose: () => void
}

export function SettingsDialog({ loaded, onSave, onReload, onClose }: Props) {
  const [text, setText] = useState(() => JSON.stringify(loaded.config, null, 2))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const readOnly = loaded.origin !== 'api'

  const save = async () => {
    setBusy(true)
    try {
      const config = parseConfig(JSON.parse(text))
      await onSave(config)
      onClose()
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusy(false)
    }
  }

  const reload = async () => {
    setBusy(true)
    try {
      await onReload()
      onClose()
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusy(false)
    }
  }

  const download = () => {
    const blob = new Blob([text], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'blizzard.config.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="flex max-h-full w-full max-w-3xl flex-col rounded-lg border border-ink-600 bg-ink-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-ink-700 px-4 py-3">
          <div>
            <h2 id="settings-title" className="text-sm font-semibold text-frost-100">Configuração</h2>
            <p className="text-xs text-frost-500">
              {readOnly
                ? 'Servidor de configuração indisponível: somente leitura. Edite public/config/blizzard.config.json no Pi.'
                : 'Salvar grava public/config/blizzard.config.json no servidor; todas as telas recarregam sozinhas.'}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1.5 text-frost-300 hover:bg-ink-700" title="Fechar (Esc)">
            <X className="h-4 w-4" />
          </button>
        </div>

        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setError(null)
          }}
          spellCheck={false}
          readOnly={readOnly}
          className="min-h-[50vh] flex-1 resize-none bg-ink-950 p-4 font-mono text-xs leading-5 text-frost-100 outline-none"
        />

        {error && <div className="border-t border-red-900/60 bg-red-950/40 px-4 py-2 text-xs text-red-300">{error}</div>}

        <div className="flex flex-wrap items-center gap-2 border-t border-ink-700 px-4 py-3">
          <button
            type="button"
            onClick={() => void save()}
            disabled={readOnly || busy}
            className="flex items-center gap-1.5 rounded bg-ice-500 px-3 py-1.5 text-xs font-semibold text-ink-950 hover:bg-ice-400 disabled:opacity-40"
          >
            <Save className="h-3.5 w-3.5" /> {busy ? 'Salvando…' : 'Salvar no servidor'}
          </button>
          <button type="button" onClick={download} className="flex items-center gap-1.5 rounded border border-ink-600 px-3 py-1.5 text-xs text-frost-100 hover:bg-ink-700">
            <Download className="h-3.5 w-3.5" /> Baixar JSON
          </button>
          <button
            type="button"
            onClick={() => void reload()}
            disabled={busy}
            className="ml-auto flex items-center gap-1.5 rounded border border-ink-600 px-3 py-1.5 text-xs text-frost-300 hover:bg-ink-700 disabled:opacity-40"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Descartar e recarregar
          </button>
        </div>
      </div>
    </div>
  )
}
