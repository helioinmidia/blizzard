import { useEffect, useState } from 'react'
import { fetchGo2rtcStatus, type Go2rtcStatus } from '../lib/go2rtc'

export function useGo2rtcStatus(go2rtcUrl: string, intervalMs = 30_000): Go2rtcStatus | null {
  const [status, setStatus] = useState<Go2rtcStatus | null>(null)
  useEffect(() => {
    let cancelled = false
    const check = async () => {
      const result = await fetchGo2rtcStatus(go2rtcUrl)
      if (!cancelled) setStatus(result)
    }
    void check()
    const id = window.setInterval(() => void check(), intervalMs)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [go2rtcUrl, intervalMs])
  return status
}
