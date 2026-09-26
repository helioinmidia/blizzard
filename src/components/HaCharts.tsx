import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent } from 'react'
import { Cloud } from 'lucide-react'
import type { HaCard } from '../lib/config'
import { conditionIcons } from '../lib/conditionIcons'
import { conditionLabel, formatNumber, haSeriesStore, isAvailable, type HaSnapshot } from '../lib/ha'

// Paleta categórica para fundo escuro, em ordem fixa (a ordem é o que garante a separação para daltônicos).
// Validada contra a superfície dos cartões (#111a2b): faixa de luminosidade, croma, CVD ≥ 8 e contraste ≥ 3:1.
const SERIES_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181']
const GRID = '#1f2c42'
const SURFACE = '#111a2b'

const hourLabel = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit' })
const timeLabel = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', hour: '2-digit', minute: '2-digit' })
const dayLabel = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' })
// A previsão diária vem datada à meia-noite UTC; formatar no fuso local mostraria o dia anterior.
const forecastDayLabel = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'UTC' })

function useSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({ width: Math.round(width), height: Math.round(height) })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, size] as const
}

/** Até ~5 marcas "redondas" que cobrem [min, max] sem desperdiçar a altura do gráfico. */
function niceTicks(min: number, max: number): number[] {
  if (min === max) {
    min -= 1
    max += 1
  }
  const rough = (max - min) / 4
  const power = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= rough) ?? rough
  const start = Math.floor(min / step) * step
  const ticks = [start]
  while (ticks[ticks.length - 1] < max) ticks.push(Math.round((ticks[ticks.length - 1] + step) * 1e6) / 1e6)
  return ticks
}

/** Marcas do eixo do tempo em horas cheias, no máximo ~6. */
function timeTicks(start: number, end: number): number[] {
  const hours = (end - start) / 3_600_000
  const every = [1, 2, 3, 6, 12, 24].find((h) => hours / h <= 6) ?? 24
  const first = new Date(start)
  first.setMinutes(0, 0, 0)
  const ticks: number[] = []
  for (let t = first.getTime(); t <= end; t += 3_600_000) {
    if (t >= start && new Date(t).getHours() % every === 0) ticks.push(t)
  }
  return ticks
}

/** O gráfico tem 8,5em de altura: daí sai o "em" da célula, para os rótulos crescerem junto com ela na TV. */
function axisMetrics(height: number) {
  const font = Math.max(9, Math.round((height / 8.5) * 0.62))
  return { font, left: Math.round(font * 3.4), bottom: Math.round(font * 1.7), top: Math.round(font * 0.7) }
}

function Empty({ text }: { text: string }) {
  return <div className="flex h-full items-center justify-center text-[0.8em] text-frost-500">{text}</div>
}

interface CardProps {
  card: HaCard
  bridgeUrl: string
  states: HaSnapshot['states']
  /** Relógio do painel (atualiza a cada 30 s): define o fim da janela dos gráficos. */
  now: number
}

export function GraphCard({ card, bridgeUrl, states, now }: CardProps) {
  const store = haSeriesStore(bridgeUrl, 'history')
  const history = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [plotRef, { width, height }] = useSize<HTMLDivElement>()
  const [hoverX, setHoverX] = useState<number | null>(null)

  const unit = card.entities.map((e) => states[e.entity]?.attributes.unit_of_measurement).find(Boolean)
  const series = useMemo(
    () =>
      card.entities.map((ref, index) => ({
        ref,
        color: SERIES_COLORS[index % SERIES_COLORS.length],
        points: history?.[ref.entity] ?? [],
      })),
    [card.entities, history],
  )

  const plot = useMemo(() => {
    const all = series.flatMap((s) => s.points)
    if (all.length === 0 || width === 0 || height === 0) return null
    const end = now
    const start = end - card.hours * 3_600_000
    const values = all.map((p) => p[1])
    const ticks = niceTicks(Math.min(...values), Math.max(...values))
    const [yMin, yMax] = [ticks[0], ticks[ticks.length - 1]]
    const { font, left, bottom, top } = axisMetrics(height)
    const innerWidth = Math.max(1, width - left - 4)
    const innerHeight = Math.max(1, height - bottom - top)
    const x = (t: number) => left + ((t - start) / (end - start)) * innerWidth
    const y = (v: number) => top + (1 - (v - yMin) / (yMax - yMin)) * innerHeight
    return { start, end, ticks, font, left, top, innerWidth, innerHeight, x, y }
  }, [series, width, height, card.hours, now])

  const hover = useMemo(() => {
    if (!plot || hoverX === null) return null
    const t = plot.start + ((hoverX - plot.left) / plot.innerWidth) * (plot.end - plot.start)
    if (t < plot.start || t > plot.end) return null
    const rows = series.flatMap((s) => {
      // O sensor só registra mudanças: o valor em t é o último ponto até ali.
      const point = [...s.points].reverse().find((p) => p[0] <= t) ?? s.points[0]
      return point ? [{ name: s.ref.name ?? s.ref.entity, color: s.color, value: point[1] }] : []
    })
    return { t, x: plot.x(t), rows }
  }, [plot, hoverX, series])

  const onMove = (ev: PointerEvent<HTMLDivElement>) => setHoverX(ev.clientX - ev.currentTarget.getBoundingClientRect().left)

  return (
    <div className="flex flex-col gap-[0.5em]">
      {/* Legenda sempre presente com 2+ séries; o valor atual fica em tinta de texto, a cor só no marcador. */}
      <ul className="flex flex-wrap gap-x-[1em] gap-y-[0.2em] text-[0.78em]">
        {series.map((s) => {
          const entity = states[s.ref.entity]
          const value = isAvailable(entity) && Number.isFinite(Number(entity.state)) ? formatNumber(Number(entity.state), unit) : '—'
          return (
            <li key={s.ref.entity} className="flex items-center gap-[0.4em]">
              <span className="h-[0.25em] w-[0.9em] rounded-full" style={{ backgroundColor: s.color }} />
              <span className="text-frost-300">{s.ref.name ?? entity?.attributes.friendly_name ?? s.ref.entity}</span>
              <span className="font-medium tabular-nums text-frost-100">{value}</span>
            </li>
          )
        })}
      </ul>

      <div ref={plotRef} className="relative h-[8.5em] w-full" onPointerMove={onMove} onPointerLeave={() => setHoverX(null)}>
        {!plot ? (
          <Empty text={history === null ? 'Carregando histórico…' : 'Sem histórico no período'} />
        ) : (
          <>
            <svg width={width} height={height} role="img" aria-label={`${card.title}: histórico das últimas ${card.hours} horas`}>
              {plot.ticks.map((tick) => (
                <g key={tick}>
                  <line x1={plot.left} x2={width - 4} y1={plot.y(tick)} y2={plot.y(tick)} stroke={GRID} strokeWidth={1} />
                  <text x={plot.left - 6} y={plot.y(tick)} textAnchor="end" dominantBaseline="middle" fontSize={plot.font} fill="#6f83a3">
                    {formatNumber(tick)}
                  </text>
                </g>
              ))}
              {timeTicks(plot.start, plot.end).map((t) => (
                <text key={t} x={plot.x(t)} y={height - 2} textAnchor="middle" fontSize={plot.font} fill="#6f83a3">
                  {hourLabel.format(t)}
                </text>
              ))}
              {series.map((s) => {
                if (s.points.length === 0) return null
                const visible = s.points.filter((p) => p[0] >= plot.start)
                const points = visible.length > 0 ? visible : [s.points[s.points.length - 1]]
                const last = points[points.length - 1]
                // Estende o último valor até "agora": sem mudança não há ponto novo, mas o valor continua valendo.
                const path = [...points, [plot.end, last[1]] as [number, number]]
                  .map((p, i) => `${i === 0 ? 'M' : 'L'}${plot.x(Math.max(p[0], plot.start)).toFixed(1)},${plot.y(p[1]).toFixed(1)}`)
                  .join('')
                return (
                  <g key={s.ref.entity}>
                    <path d={path} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                    <circle cx={plot.x(plot.end)} cy={plot.y(last[1])} r={4} fill={s.color} stroke={SURFACE} strokeWidth={2} />
                  </g>
                )
              })}
              {hover && <line x1={hover.x} x2={hover.x} y1={plot.top} y2={plot.top + plot.innerHeight} stroke="#6f83a3" strokeWidth={1} />}
            </svg>
            {hover && hover.rows.length > 0 && (
              <div
                className="pointer-events-none absolute top-0 z-10 rounded border border-ink-600 bg-ink-950/95 px-2 py-1 text-[11px] leading-4 whitespace-nowrap shadow-lg"
                style={hover.x > width / 2 ? { right: width - hover.x + 8 } : { left: hover.x + 8 }}
              >
                <div className="mb-0.5 text-frost-500">{timeLabel.format(hover.t)}</div>
                {hover.rows.map((row) => (
                  <div key={row.name} className="flex items-center gap-1.5">
                    <span className="h-1 w-2.5 rounded-full" style={{ backgroundColor: row.color }} />
                    <span className="text-frost-300">{row.name}</span>
                    <span className="ml-auto pl-2 font-medium tabular-nums text-frost-100">{formatNumber(row.value, unit)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export function BarsCard({ card, bridgeUrl, states, now }: CardProps) {
  const store = haSeriesStore(bridgeUrl, 'statistics')
  const statistics = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [plotRef, { width, height }] = useSize<HTMLDivElement>()
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  const ref = card.entities[0]
  const points = useMemo(() => (ref ? statistics?.[ref.entity] ?? [] : []), [ref, statistics])
  // A estatística vem do medidor acumulado; a unidade está no estado dele quando a ponte o acompanha.
  const unit = (ref && states[ref.entity]?.attributes.unit_of_measurement) || 'kWh'

  const plot = useMemo(() => {
    if (points.length === 0 || width === 0 || height === 0) return null
    const ticks = niceTicks(0, Math.max(...points.map((p) => p[1]), 0.1))
    const yMax = ticks[ticks.length - 1]
    const { font, left, bottom, top } = axisMetrics(height)
    const innerWidth = Math.max(1, width - left - 4)
    const innerHeight = Math.max(1, height - bottom - top)
    const band = innerWidth / points.length
    // Barra fina: no máximo 24 px e sempre com 2 px de respiro entre vizinhas.
    const bar = Math.max(1, Math.min(24, band - 2))
    const y = (v: number) => top + (1 - Math.max(0, v) / yMax) * innerHeight
    return { ticks, font, left, innerHeight, band, bar, y, baseline: top + innerHeight }
  }, [points, width, height])

  const midnight = new Date(now).setHours(0, 0, 0, 0)
  const total = points.filter((p) => p[0] >= midnight).reduce((sum, p) => sum + p[1], 0)

  const onMove = (ev: PointerEvent<HTMLDivElement>) => {
    if (!plot) return
    const x = ev.clientX - ev.currentTarget.getBoundingClientRect().left - plot.left
    const index = Math.floor(x / plot.band)
    setHoverIndex(index >= 0 && index < points.length ? index : null)
  }

  const hovered = hoverIndex !== null ? points[hoverIndex] : null

  return (
    <div className="flex flex-col gap-[0.5em]">
      <div className="flex items-baseline gap-[0.5em] text-[0.78em]">
        <span className="text-frost-300">{ref?.name ?? 'Hoje'}</span>
        <span className="font-medium tabular-nums text-frost-100">{formatNumber(Math.round(total * 100) / 100, unit)}</span>
        <span className="text-frost-500">hoje</span>
      </div>
      <div ref={plotRef} className="relative h-[8.5em] w-full" onPointerMove={onMove} onPointerLeave={() => setHoverIndex(null)}>
        {!plot ? (
          <Empty text={statistics === null ? 'Carregando estatísticas…' : 'Sem estatísticas no período'} />
        ) : (
          <>
            <svg width={width} height={height} role="img" aria-label={`${card.title}: variação por hora nas últimas 48 horas`}>
              {plot.ticks.map((tick) => (
                <g key={tick}>
                  <line x1={plot.left} x2={width - 4} y1={plot.y(tick)} y2={plot.y(tick)} stroke={GRID} strokeWidth={1} />
                  <text x={plot.left - 6} y={plot.y(tick)} textAnchor="end" dominantBaseline="middle" fontSize={plot.font} fill="#6f83a3">
                    {formatNumber(tick)}
                  </text>
                </g>
              ))}
              {points.map(([t, value], index) => {
                const x = plot.left + index * plot.band + (plot.band - plot.bar) / 2
                const top = plot.y(value)
                const h = Math.max(0, plot.baseline - top)
                const r = Math.min(4, plot.bar / 2, h)
                const hour = new Date(t).getHours()
                return (
                  <g key={t}>
                    {/* Topo arredondado, base reta na linha de zero. */}
                    <path
                      d={`M${x},${plot.baseline}V${top + r}Q${x},${top} ${x + r},${top}H${x + plot.bar - r}Q${x + plot.bar},${top} ${x + plot.bar},${top + r}V${plot.baseline}Z`}
                      fill={SERIES_COLORS[0]}
                      opacity={hoverIndex === null || hoverIndex === index ? 1 : 0.45}
                    />
                    {hour % 12 === 0 && (
                      <text x={x + plot.bar / 2} y={height - 2} textAnchor="middle" fontSize={plot.font} fill="#6f83a3">
                        {hour === 0 ? dayLabel.format(t) : hourLabel.format(t)}
                      </text>
                    )}
                  </g>
                )
              })}
            </svg>
            {hovered && hoverIndex !== null && (
              <div
                className="pointer-events-none absolute top-0 z-10 rounded border border-ink-600 bg-ink-950/95 px-2 py-1 text-[11px] leading-4 whitespace-nowrap shadow-lg"
                style={
                  hoverIndex > points.length / 2
                    ? { right: width - (plot.left + hoverIndex * plot.band) + 4 }
                    : { left: plot.left + (hoverIndex + 1) * plot.band + 4 }
                }
              >
                <div className="text-frost-500">{timeLabel.format(hovered[0])}</div>
                <div className="font-medium tabular-nums text-frost-100">{formatNumber(hovered[1], unit)}</div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}


export function WeatherCard({ card, states, forecasts }: { card: HaCard; states: HaSnapshot['states']; forecasts: HaSnapshot['forecasts'] }) {
  const entityId = card.entities[0]?.entity ?? ''
  const entity = states[entityId]
  const days = forecasts[entityId] ?? []
  if (!isAvailable(entity)) return <Empty text="Previsão indisponível" />

  const Icon = conditionIcons[entity.state] ?? Cloud
  const { temperature, humidity, wind_speed: wind, wind_speed_unit: windUnit } = entity.attributes

  return (
    <div className="flex flex-col gap-[0.7em]">
      <div className="flex items-center gap-[0.7em]">
        <Icon className="h-[2.4em] w-[2.4em] shrink-0 text-ice-400" strokeWidth={1.5} />
        <div className="min-w-0">
          <div className="text-[1.7em] leading-none font-semibold tabular-nums text-frost-100">
            {typeof temperature === 'number' ? formatNumber(temperature, '°C') : '—'}
          </div>
          <div className="truncate text-[0.8em] text-frost-300">{conditionLabel(entity.state)}</div>
        </div>
        <div className="ml-auto text-right text-[0.75em] leading-[1.5] text-frost-300">
          {typeof humidity === 'number' && <div>Umidade {formatNumber(humidity, '%')}</div>}
          {typeof wind === 'number' && <div>Vento {formatNumber(wind, windUnit ?? 'km/h')}</div>}
        </div>
      </div>

      {days.length > 0 && (
        <ul className="grid gap-[0.3em]" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
          {days.map((day) => {
            const DayIcon = conditionIcons[day.condition ?? ''] ?? Cloud
            return (
              <li key={day.datetime} className="flex flex-col items-center gap-[0.2em] rounded-[0.4em] bg-ink-900/70 py-[0.4em]" title={conditionLabel(day.condition)}>
                <span className="text-[0.7em] text-frost-500 uppercase">{forecastDayLabel.format(new Date(day.datetime)).replace('.', '')}</span>
                <DayIcon className="h-[1.3em] w-[1.3em] text-frost-300" strokeWidth={1.5} />
                <span className="text-[0.8em] font-medium tabular-nums text-frost-100">
                  {typeof day.temperature === 'number' ? `${Math.round(day.temperature)}°` : '—'}
                </span>
                <span className="text-[0.7em] tabular-nums text-frost-500">{typeof day.templow === 'number' ? `${Math.round(day.templow)}°` : ' '}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
