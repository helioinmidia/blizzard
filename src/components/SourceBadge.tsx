import { Camera, Home, ShieldCheck, LayoutDashboard } from 'lucide-react'
import type { SourceKind } from '../lib/config'

const styles: Record<SourceKind, { label: string; className: string; Icon: typeof Camera }> = {
  unifi_protect: { label: 'UniFi Protect', className: 'bg-ice-500/15 text-ice-400', Icon: Home },
  intelbras: { label: 'Intelbras', className: 'bg-forest-500/15 text-forest-400', Icon: ShieldCheck },
  home_assistant: { label: 'Home Assistant', className: 'bg-amber-500/15 text-amber-300', Icon: LayoutDashboard },
  other: { label: 'Outro', className: 'bg-white/10 text-frost-300', Icon: Camera },
}

export function SourceBadge({ kind, name }: { kind: SourceKind; name?: string }) {
  const { label, className, Icon } = styles[kind]
  return (
    <span className={`chip shrink-0 ${className}`}>
      <Icon className="h-3 w-3" />
      {name ?? label}
    </span>
  )
}
