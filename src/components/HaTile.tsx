import { useEffect, useState, useSyncExternalStore } from 'react'
import { Loader2, WifiOff } from 'lucide-react'
import type { HaCard, HaSource } from '../lib/config'
import { describeEntity, haStore, isStatCard, summarizeCard, type HaSnapshot, type Tone } from '../lib/ha'
import { BarsCard, GraphCard, WeatherCard } from './HaCharts'

const toneText: Record<Tone, string> = {
  neutral: 'text-frost-100',
  active: 'text-ice-400',
  alert: 'text-red-300',
  muted: 'text-frost-500',
}

const toneDot: Record<Tone, string> = {
  neutral: 'bg-ink-600',
  active: 'bg-ice-400',
  alert: 'bg-red-400 pulse-critical',
  muted: 'bg-ink-700',
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

interface CardProps {
  card: HaCard
  bridgeUrl: string
  states: HaSnapshot['states']
  forecasts: HaSnapshot['forecasts']
  now: number
}

function Card({ card, bridgeUrl, states, forecasts, now }: CardProps) {
  const summary = summarizeCard(card, states)
  const stat = isStatCard(card)
  // Listas longas (ex.: movimento em todos os cômodos) ocupam a largura toda, em duas colunas.
  const wide = !stat && card.entities.length > 6

  return (
    <section className={`flex min-w-0 flex-col rounded-[0.5em] border border-ink-700 bg-ink-800/70 p-[0.75em] ${wide ? 'col-span-full' : ''}`}>
      <header className="mb-[0.5em] flex items-baseline justify-between gap-[0.5em]">
        <h3 className="truncate text-[0.72em] font-semibold uppercase tracking-wider text-frost-500">{card.title}</h3>
        {summary && <span className={`shrink-0 text-[0.78em] font-medium ${toneText[summary.tone]}`}>{summary.text}</span>}
      </header>

      {card.kind === 'graph' ? (
        <GraphCard card={card} bridgeUrl={bridgeUrl} states={states} now={now} />
      ) : card.kind === 'bars' ? (
        <BarsCard card={card} bridgeUrl={bridgeUrl} states={states} now={now} />
      ) : card.kind === 'weather' ? (
        <WeatherCard card={card} states={states} forecasts={forecasts} />
      ) : stat ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(5.2em,1fr))] gap-x-[0.75em] gap-y-[0.6em]">
          {card.entities.map((ref) => {
            const entity = states[ref.entity]
            const view = describeEntity(ref.entity, entity, now)
            return (
              <div key={ref.entity} className="min-w-0">
                <div className={`truncate text-[1.3em] leading-tight font-semibold tabular-nums ${toneText[view.tone]}`}>
                  {view.tone === 'muted' ? '—' : view.value}
                </div>
                <div className="truncate text-[0.72em] text-frost-300">{ref.name ?? entity?.attributes.friendly_name ?? ref.entity}</div>
              </div>
            )
          })}
        </div>
      ) : (
        <ul className={wide ? 'grid grid-cols-2 gap-x-[1.5em] gap-y-[0.35em]' : 'flex flex-col gap-[0.35em]'}>
          {card.entities.map((ref) => {
            const entity = states[ref.entity]
            const view = describeEntity(ref.entity, entity, now)
            return (
              <li key={ref.entity} className="flex min-w-0 items-center gap-[0.5em] text-[0.9em]">
                <span className={`h-[0.5em] w-[0.5em] shrink-0 rounded-full ${toneDot[view.tone]}`} />
                <span className="min-w-0 flex-1 truncate text-frost-300">{ref.name ?? entity?.attributes.friendly_name ?? ref.entity}</span>
                {view.detail && <span className="shrink-0 text-[0.8em] tabular-nums text-frost-500">{view.detail}</span>}
                <span className={`shrink-0 font-medium ${toneText[view.tone]}`}>{view.value}</span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

export function HaTile({ source }: { source: HaSource }) {
  const store = haStore(source.bridgeUrl)
  const { status, states, forecasts } = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const now = useNow(30_000)
  const hasData = Object.keys(states).length > 0

  return (
    // A fonte acompanha a largura da célula (cqw): legível tanto na grade 3×2 quanto ampliada na TV.
    <div className="h-full w-full bg-ink-900 [container-type:size]">
      <div
        className="relative h-full w-full overflow-y-auto px-[0.75em] pt-[2.3em] pb-[0.5em] [scrollbar-width:none]"
        style={{ fontSize: `clamp(10px, ${(2.15 * source.scale).toFixed(2)}cqw, 40px)` }}
      >
        {!hasData && status !== 'online' ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-frost-300">
            {status === 'connecting' ? (
              <>
                <Loader2 className="h-7 w-7 animate-spin text-ice-400" />
                <span className="text-xs">Conectando ao Home Assistant…</span>
              </>
            ) : (
              <>
                <WifiOff className="h-8 w-8 text-red-400" />
                <span className="text-xs font-medium text-red-300">
                  {status === 'offline' ? 'Home Assistant fora do ar' : 'Ponte do Home Assistant inacessível'}
                </span>
              </>
            )}
          </div>
        ) : (
          <div className="grid grid-flow-row-dense grid-cols-[repeat(auto-fit,minmax(min(100%,15em),1fr))] items-start gap-[0.6em]">
            {source.cards.map((card, index) => (
              <Card key={`${index}-${card.title}`} card={card} bridgeUrl={source.bridgeUrl} states={states} forecasts={forecasts} now={now} />
            ))}
          </div>
        )}
        {hasData && status !== 'online' && (
          <span className="absolute right-[0.75em] bottom-[0.5em] flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-amber-300">
            <WifiOff className="h-3 w-3" /> sem atualização
          </span>
        )}
      </div>
    </div>
  )
}
