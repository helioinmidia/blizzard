import { Camera, Home, ShieldCheck, LayoutDashboard } from 'lucide-react'
import type { SourceKind } from '../lib/config'

const styles: Record<SourceKind, { label: string; className: string; Icon: typeof Camera }> = {
  unifi_protect: { label: 'UniFi Protect', className: 'bg-ice-500/20 text-ice-400', Icon: Home },
  intelbras: { label: 'Intelbras', className: 'bg-forest-500/20 text-forest-400', Icon: ShieldCheck },
  home_assistant: { label: 'Home Assistant', className: 'bg-amber-500/20 text-amber-300', Icon: LayoutDashboard },
  other: { label: 'Outro', className: 'bg-frost-500/20 text-frost-300', Icon: Camera },
}

export function SourceBadge({ kind, name }: { kind: SourceKind; name?: string }) {
  const { label, className, Icon } = styles[kind]
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${className}`}>
      <Icon className="h-3 w-3" />
      {name ?? label}
    </span>
  )
}
