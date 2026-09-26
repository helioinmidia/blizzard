import { useSyncExternalStore } from 'react'
import { Cloud, Thermometer } from 'lucide-react'
import type { HeaderTemperature as HeaderTemperatureConfig } from '../lib/config'
import { conditionLabel, formatNumber, haStore, isAvailable } from '../lib/ha'
import { conditionIcons } from '../lib/conditionIcons'

interface Props {
  config: HeaderTemperatureConfig
}

/** Temperatura atual no cabeçalho: weather.* (com condição), sensor.* (valor e unidade) ou climate.*. */
export function HeaderTemperature({ config }: Props) {
  const store = haStore(config.bridgeUrl)
  const { status, states } = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const entity = states[config.entity]
  const domain = config.entity.slice(0, config.entity.indexOf('.'))

  let value: string | null = null
  let detail: string | null = null
  let Icon = Thermometer
  if (isAvailable(entity)) {
    if (domain === 'weather') {
      const t = entity.attributes.temperature
      value = typeof t === 'number' ? formatNumber(t, entity.attributes.temperature_unit ?? '°C') : null
      detail = conditionLabel(entity.state)
      Icon = conditionIcons[entity.state] ?? Cloud
    } else if (domain === 'climate') {
      const t = entity.attributes.current_temperature
      value = typeof t === 'number' ? formatNumber(t, '°C') : null
    } else {
      const n = Number(entity.state)
      value = Number.isFinite(n) ? formatNumber(n, entity.attributes.unit_of_measurement ?? '°C') : entity.state
    }
  }
  const stale = status !== 'online'
  const label = config.label ?? (detail ?? (entity?.attributes.friendly_name ?? null))

  return (
    <div
      className={`flex items-center gap-3 rounded-2xl px-3 py-1.5 ${stale ? 'opacity-60' : ''}`}
      title={stale ? 'Home Assistant sem conexão; último valor conhecido' : config.entity}
    >
      <Icon className="h-7 w-7 shrink-0 text-ice-400" strokeWidth={1.6} aria-hidden="true" />
      <div className="flex flex-col leading-none">
        <span className="text-[26px] font-bold tracking-tight tabular-nums">{value ?? '—'}</span>
        {label && <span className="mt-1 max-w-[220px] truncate text-[12px] text-frost-500">{label}</span>}
      </div>
    </div>
  )
}
