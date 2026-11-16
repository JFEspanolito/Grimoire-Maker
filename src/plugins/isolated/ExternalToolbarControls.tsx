import type { ToolbarItem } from '../../lib/externalPlugins'
import { useRulerStore } from '../../stores/rulerStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTabStore } from '../../stores/tabStore'
import styles from './ExternalToolbar.module.css'

type Option = ToolbarItem['options'][number]

/** The manifest options plus the current value when it is not listed, ascending. */
function withCurrent(options: Option[], current: number): Option[] {
  const listed = options.some((option) => Number(option.value) === current)
  const all = listed ? options : [...options, { value: String(current), label: `${Math.round(current * 100)}%` }]
  return [...all].sort((a, b) => Number(a.value) - Number(b.value))
}

/** The `when: "markdown"` rule: controls only apply while the active file is Markdown. */
function useBlocked(item: ToolbarItem): boolean {
  const path = useTabStore((state) => state.active)
  return item.when === 'markdown' && !!path && !/\.md$/i.test(path)
}

export function ZoomSelect({ item, value, onSelect, disabled }: {
  item: ToolbarItem; value: number; onSelect: (value: number) => void; disabled?: boolean
}) {
  return (
    <label className={styles.control}>
      {item.label}
      <select aria-label={item.slot === 'preview' ? `Preview ${item.label.toLowerCase()}` : `Editor ${item.label.toLowerCase()}`} value={value} disabled={disabled} onChange={(event) => onSelect(Number(event.target.value))}>
        {withCurrent(item.options, value).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  )
}

export function EditorZoom({ item }: { item: ToolbarItem }) {
  const zoom = useSettingsStore((state) => state.zoom)
  const setZoom = useSettingsStore((state) => state.setZoom)
  return <ZoomSelect item={item} value={zoom} onSelect={setZoom} disabled={useBlocked(item)} />
}

export function RulerToggle({ item }: { item: ToolbarItem }) {
  const visible = useRulerStore((state) => state.visible)
  const toggle = useRulerStore((state) => state.toggle)
  return (
    <button type="button" className={styles.toggle} aria-label={item.label} aria-pressed={visible}
      disabled={useBlocked(item)} onClick={toggle}>{item.label}</button>
  )
}
