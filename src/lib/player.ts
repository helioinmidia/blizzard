import { VideoRTC, type StreamMessage } from '../vendor/video-rtc.js'

export type PlayerStatus = 'idle' | 'connecting' | 'playing' | 'error'

export interface PlayerState {
  status: PlayerStatus
  mode: string
  error: string | null
}

export const PLAYER_STATE_EVENT = 'blizzard:state'

/**
 * Elemento <blizzard-video>: estende o player oficial do go2rtc (WebRTC → MSE → HLS → MJPEG)
 * sem controles nativos, sempre mudo (autoplay em quiosque) e emitindo eventos de estado
 * que o React usa para desenhar o overlay.
 */
export class BlizzardVideo extends VideoRTC {
  private emit(state: PlayerState): void {
    this.dispatchEvent(new CustomEvent<PlayerState>(PLAYER_STATE_EVENT, { detail: state }))
  }

  oninit(): void {
    super.oninit()
    this.video.controls = false
    this.video.muted = true
    this.video.autoplay = true
    this.video.style.objectFit = 'contain'
    this.video.style.backgroundColor = '#000'
  }

  /**
   * Igual ao original, mas cada socket só responde por si. No original, o "close" atrasado de um socket
   * já substituído (troca de stream ao ampliar, remontagem do React) zerava `this.ws` do socket novo,
   * mostrava "go2rtc inacessível" e abria uma terceira conexão, deixando a segunda órfã.
   */
  onconnect(): boolean {
    if (!this.isConnected || !this.wsURL || this.ws || this.pc) return false
    this.wsState = WebSocket.CONNECTING
    this.connectTS = Date.now()
    const ws = new WebSocket(this.wsURL)
    ws.binaryType = 'arraybuffer'
    ws.addEventListener('open', () => {
      if (this.ws === ws) this.onopen()
    })
    ws.addEventListener('close', () => {
      if (this.ws === ws) this.onclose()
    })
    this.ws = ws
    this.emit({ status: 'connecting', mode: '', error: null })
    return true
  }

  onopen(): string[] {
    const modes = super.onopen()
    if (this.onmessage) {
      this.onmessage['blizzard'] = (msg: StreamMessage) => {
        switch (msg.type) {
          case 'error':
            this.emit({ status: 'error', mode: '', error: msg.value })
            break
          case 'mse':
          case 'hls':
          case 'mp4':
          case 'mjpeg':
            this.emit({ status: 'playing', mode: msg.type.toUpperCase(), error: null })
            break
        }
      }
    }
    return modes
  }

  onpcvideo(ev: Event): void {
    super.onpcvideo(ev)
    if (this.pcState !== WebSocket.CLOSED) {
      this.emit({ status: 'playing', mode: 'WebRTC', error: null })
    }
  }

  onclose(): boolean {
    const wasOpen = this.wsState === WebSocket.OPEN
    const willReconnect = super.onclose()
    if (willReconnect) {
      this.emit({
        status: 'error',
        mode: '',
        error: wasOpen ? 'Conexão perdida, reconectando…' : 'go2rtc inacessível, tentando de novo…',
      })
    }
    return willReconnect
  }

  /** Igual ao original, mas limpa o <video> sem disparar MEDIA_ERR_SRC_NOT_SUPPORTED. */
  ondisconnect(): void {
    this.wsState = WebSocket.CLOSED
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.pcState = WebSocket.CLOSED
    if (this.pc) {
      this.pc.getSenders().forEach((sender) => sender.track?.stop())
      this.pc.close()
      this.pc = null
    }
    this.video.srcObject = null
    this.video.removeAttribute('src')
    this.video.load()
    this.emit({ status: 'idle', mode: '', error: null })
  }
}

export const PLAYER_TAG = 'blizzard-video'

if (!customElements.get(PLAYER_TAG)) {
  customElements.define(PLAYER_TAG, BlizzardVideo)
}
