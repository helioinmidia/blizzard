export function streamSocketUrl(go2rtcUrl: string, stream: string): string {
  return `${go2rtcUrl}/api/ws?src=${encodeURIComponent(stream)}`
}

export interface Go2rtcStatus {
  reachable: boolean
  /** Nomes dos streams que o go2rtc conhece. */
  streams: string[]
  checkedAt: number
}

export async function fetchGo2rtcStatus(go2rtcUrl: string): Promise<Go2rtcStatus> {
  try {
    const response = await fetch(`${go2rtcUrl}/api/streams`, { cache: 'no-store' })
    if (!response.ok) return { reachable: false, streams: [], checkedAt: Date.now() }
    const body = (await response.json()) as Record<string, unknown>
    return { reachable: true, streams: Object.keys(body), checkedAt: Date.now() }
  } catch {
    return { reachable: false, streams: [], checkedAt: Date.now() }
  }
}
