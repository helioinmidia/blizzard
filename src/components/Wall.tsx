import type { BlizzardConfig, View } from '../lib/config'
import { findSource } from '../lib/config'
import { Tile } from './Tile'

interface Props {
  config: BlizzardConfig
  view: View
  focusedSlot: number | null
  onFocus: (slotIndex: number | null) => void
  onChangeSource: (slotIndex: number, sourceId: string | null) => void
}

/** Com células ampliadas (view.spans) a grade enche antes do fim da lista: o que não cabe fica de fora. */
function visibleCells(view: View) {
  const total = view.columns * view.rows
  const cells: { sourceId: string | null; index: number; span: { cols: number; rows: number } }[] = []
  let used = 0
  view.slots.forEach((sourceId, index) => {
    const span = view.spans?.[String(index)] ?? { cols: 1, rows: 1 }
    const area = span.cols * span.rows
    if (used + area > total) return
    used += area
    cells.push({ sourceId, index, span })
  })
  return cells
}

export function Wall({ config, view, focusedSlot, onFocus, onChangeSource }: Props) {
  if (focusedSlot !== null) {
    return (
      <div className="h-full w-full p-1">
        <Tile
          config={config}
          source={findSource(config, view.slots[focusedSlot] ?? null)}
          slotIndex={focusedSlot}
          focused
          onFocus={onFocus}
          onChangeSource={onChangeSource}
        />
      </div>
    )
  }

  const cells = visibleCells(view)

  return (
    <div
      className="grid h-full w-full grid-flow-row-dense gap-1 p-1"
      style={{
        gridTemplateColumns: `repeat(${view.columns}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${view.rows}, minmax(0, 1fr))`,
      }}
    >
      {cells.map(({ sourceId, index, span }) => (
        <div
          key={`${view.id}-${index}-${sourceId ?? 'empty'}`}
          className="min-h-0 min-w-0"
          style={{ gridColumn: `span ${span.cols}`, gridRow: `span ${span.rows}` }}
        >
          <Tile
            config={config}
            source={findSource(config, sourceId)}
            slotIndex={index}
            focused={false}
            onFocus={onFocus}
            onChangeSource={onChangeSource}
          />
        </div>
      ))}
    </div>
  )
}
