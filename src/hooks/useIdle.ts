import { useEffect, useState } from 'react'

/** Verdadeiro quando não há mouse/teclado há `timeoutMs`. Usado para esconder a interface na TV. */
export function useIdle(timeoutMs: number): boolean {
  const [idle, setIdle] = useState(false)
  useEffect(() => {
    let id = window.setTimeout(() => setIdle(true), timeoutMs)
    const wake = () => {
      setIdle(false)
      window.clearTimeout(id)
      id = window.setTimeout(() => setIdle(true), timeoutMs)
    }
    const events: (keyof WindowEventMap)[] = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel']
    events.forEach((ev) => window.addEventListener(ev, wake, { passive: true }))
    return () => {
      window.clearTimeout(id)
      events.forEach((ev) => window.removeEventListener(ev, wake))
    }
  }, [timeoutMs])
  return idle
}
