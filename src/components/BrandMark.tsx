import { useState } from 'react'

const LOGO_CANDIDATES = ['/brand/logo.svg', '/brand/logo.png']

/** Logo da marca em public/brand/ (fora do git); sem ela, o símbolo padrão da Blizzard. */
export function BrandMark({ className = 'h-9 w-9' }: { className?: string }) {
  const [index, setIndex] = useState(0)
  const src = LOGO_CANDIDATES[index]
  if (src) {
    return (
      <img
        src={src}
        alt="Vertex Softwares"
        className={`${className} shrink-0 rounded-xl object-contain`}
        onError={() => setIndex((i) => i + 1)}
      />
    )
  }
  return (
    <div className={`${className} flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-ice-400 to-ice-500`}>
      <svg width="50%" height="50%" viewBox="0 0 24 24" fill="none" stroke="#052033" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
        <path d="M12 2v20M3 7l18 10M3 17l18-10" />
      </svg>
    </div>
  )
}
