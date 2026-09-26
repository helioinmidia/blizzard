import { useEffect, useRef, useState } from 'react'
import { Loader2, VideoOff } from 'lucide-react'
import { PLAYER_STATE_EVENT, type BlizzardVideo, type PlayerState } from '../lib/player'
import { streamSocketUrl } from '../lib/go2rtc'

interface Props {
  go2rtcUrl: string
  stream: string
  playerMode: string
  fit: 'cover' | 'contain'
  onState?: (state: PlayerState) => void
  /** Resolução decodificada (largura × altura), ou null enquanto não há vídeo. */
  onResolution?: (resolution: { width: number; height: number } | null) => void
}

const initialState: PlayerState = { status: 'idle', mode: '', error: null }

/** Tempo sem vídeo até a célula refazer a conexão do zero. A TV fica ligada sem ninguém para dar F5. */
const WATCHDOG_MS = 30_000

export function VideoTile({ go2rtcUrl, stream, playerMode, fit, onState, onResolution }: Props) {
  const ref = useRef<BlizzardVideo | null>(null)
  const [state, setState] = useState<PlayerState>(initialState)
  const onStateRef = useRef(onState)
  const onResolutionRef = useRef(onResolution)
  useEffect(() => {
    onStateRef.current = onState
    onResolutionRef.current = onResolution
  }, [onState, onResolution])

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const handle = (ev: Event) => {
      const next = (ev as CustomEvent<PlayerState>).detail
      setState(next)
      onStateRef.current?.(next)
    }
    element.addEventListener(PLAYER_STATE_EVENT, handle)
    // A resolução real vem do <video> interno (WebRTC/MSE); em MJPEG não há vídeo decodificado.
    const video = element.video
    const report = () => {
      if (video && video.videoWidth > 0 && video.videoHeight > 0) {
        onResolutionRef.current?.({ width: video.videoWidth, height: video.videoHeight })
      }
    }
    if (video) {
      video.style.objectFit = fit
      // Com cover, o corte fica embaixo/à direita: o carimbo nativo da câmera (canto superior esquerdo) permanece visível.
      video.style.objectPosition = fit === 'cover' ? 'left top' : 'center'
    }
    video?.addEventListener('loadedmetadata', report)
    video?.addEventListener('resize', report)
    onResolutionRef.current?.(null)
    element.mode = playerMode
    element.media = 'video'
    element.src = streamSocketUrl(go2rtcUrl, stream)
    return () => {
      element.removeEventListener(PLAYER_STATE_EVENT, handle)
      video?.removeEventListener('loadedmetadata', report)
      video?.removeEventListener('resize', report)
      onResolutionRef.current?.(null)
      element.ondisconnect()
      setState(initialState)
      onStateRef.current?.(initialState)
    }
  }, [go2rtcUrl, stream, playerMode, fit])

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
