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

export function Wall({ config, view, focusedSlot, onFocus, onChangeSource }: Props) {
  if (focusedSlot !== null) {
    return (
      <div className="h-full w-full">
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

  return (
    <div
      className="grid h-full w-full gap-3.5"
      style={{
        gridTemplateColumns: `repeat(${view.columns}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${view.rows}, minmax(0, 1fr))`,
      }}
    >
      {view.slots.map((sourceId, index) => (
        <Tile
          key={`${view.id}-${index}-${sourceId ?? 'empty'}`}
          config={config}
          source={findSource(config, sourceId)}
          slotIndex={index}
          focused={false}
          onFocus={onFocus}
          onChangeSource={onChangeSource}
        />
      ))}
    </div>
  )
}
