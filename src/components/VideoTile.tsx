import { useEffect, useRef, useState } from 'react'
import { Loader2, VideoOff } from 'lucide-react'
import { PLAYER_STATE_EVENT, type BlizzardVideo, type PlayerState } from '../lib/player'
import { streamSocketUrl } from '../lib/go2rtc'

interface Props {
  go2rtcUrl: string
  stream: string
  playerMode: string
}

const initialState: PlayerState = { status: 'idle', mode: '', error: null }

export function VideoTile({ go2rtcUrl, stream, playerMode }: Props) {
  const ref = useRef<BlizzardVideo | null>(null)
  const [state, setState] = useState<PlayerState>(initialState)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const onState = (ev: Event) => setState((ev as CustomEvent<PlayerState>).detail)
    element.addEventListener(PLAYER_STATE_EVENT, onState)
    element.mode = playerMode
    element.media = 'video'
    element.src = streamSocketUrl(go2rtcUrl, stream)
    return () => {
      element.removeEventListener(PLAYER_STATE_EVENT, onState)
      element.ondisconnect()
      setState(initialState)
    }
  }, [go2rtcUrl, stream, playerMode])

  return (
    <div className="relative h-full w-full bg-black">
      <blizzard-video ref={ref} className="block h-full w-full" />
      {state.status !== 'playing' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-ink-950/70 text-frost-300">
          {state.status === 'error' ? (
            <>
              <VideoOff className="h-8 w-8 text-red-400" />
              <span className="text-xs font-medium text-red-300">Sem sinal</span>
              <span className="max-w-[80%] truncate text-[10px] text-frost-500">{state.error}</span>
            </>
          ) : (
            <>
              <Loader2 className="h-7 w-7 animate-spin text-ice-400" />
              <span className="text-xs">Conectando…</span>
            </>
          )}
        </div>
      )}
      {state.status === 'playing' && (
        <span className="absolute right-2 bottom-2 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-frost-300">
          {state.mode}
        </span>
      )}
    </div>
  )
}
