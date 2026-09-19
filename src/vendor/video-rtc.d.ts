// Declarações de tipo para o player do go2rtc (src/vendor/video-rtc.js, MIT).
export interface StreamMessage {
  type: string
  value: string
}

export class VideoRTC extends HTMLElement {
  DISCONNECT_TIMEOUT: number
  RECONNECT_TIMEOUT: number
  CODECS: string[]
  mode: string
  media: string
  background: boolean
  visibilityThreshold: number
  visibilityCheck: boolean
  pcConfig: RTCConfiguration
  wsState: number
  pcState: number
  video: HTMLVideoElement
  ws: WebSocket | null
  wsURL: string
  pc: RTCPeerConnection | null
  mseCodecs: string
  onmessage: Record<string, (msg: StreamMessage) => void> | null

  set src(value: string)
  play(): void
  send(value: unknown): void
  codecs(isSupported: (codec: string) => boolean): string
  connectedCallback(): void
  disconnectedCallback(): void
  oninit(): void
  onconnect(): boolean
  ondisconnect(): void
  onopen(): string[]
  onclose(): boolean
  onmse(): void
  onwebrtc(): void
  onpcvideo(ev: Event): void
  onmjpeg(): void
  onhls(): void
}
