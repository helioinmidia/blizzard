import { useEffect, useRef, useState } from 'react'
import { Loader2, VideoOff } from 'lucide-react'
import { PLAYER_STATE_EVENT, type BlizzardVideo, type PlayerState } from '../lib/player'
import { streamSocketUrl } from '../lib/go2rtc'

interface Props {
  go2rtcUrl: string
  stream: string
  playerMode: string
  onState?: (state: PlayerState) => void
}

const initialState: PlayerState = { status: 'idle', mode: '', error: null }

/** Tempo sem vídeo até a célula refazer a conexão do zero. A TV fica ligada sem ninguém para dar F5. */
const WATCHDOG_MS = 30_000

export function VideoTile({ go2rtcUrl, stream, playerMode, onState }: Props) {
  const ref = useRef<BlizzardVideo | null>(null)
  const [state, setState] = useState<PlayerState>(initialState)
  const onStateRef = useRef(onState)
  useEffect(() => {
    onStateRef.current = onState
  }, [onState])

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const handle = (ev: Event) => {
      const next = (ev as CustomEvent<PlayerState>).detail
      setState(next)
      onStateRef.current?.(next)
    }
    element.addEventListener(PLAYER_STATE_EVENT, handle)
    element.mode = playerMode
    element.media = 'video'
    element.src = streamSocketUrl(go2rtcUrl, stream)
    return () => {
      element.removeEventListener(PLAYER_STATE_EVENT, handle)
      element.ondisconnect()
      setState(initialState)
      onStateRef.current?.(initialState)
    }
  }, [go2rtcUrl, stream, playerMode])

  useEffect(() => {
    if (state.status === 'playing') return
    const id = window.setTimeout(() => {
      const element = ref.current
      if (!element) return
      element.ondisconnect()
      element.src = streamSocketUrl(go2rtcUrl, stream)
    }, WATCHDOG_MS)
    return () => window.clearTimeout(id)
  }, [state, go2rtcUrl, stream])

  return (
    <div className="relative h-full w-full bg-black">
      <blizzard-video ref={ref} className="block h-full w-full" />
      {state.status !== 'playing' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-ink-900/80 text-frost-300">
          {state.status === 'error' ? (
            <>
              <VideoOff className="h-7 w-7 text-amber-400" />
              <span className="text-sm font-semibold text-frost-100">Sem sinal</span>
              <span className="max-w-[85%] truncate text-[11px] text-frost-500">{state.error}</span>
            </>
          ) : (
            <>
              <Loader2 className="h-7 w-7 animate-spin text-ice-400" />
              <span className="text-xs">Conectando…</span>
            </>
          )}
        </div>
      )}
    </div>
  )
}
