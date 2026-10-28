import type { ComponentType } from 'react'
import type { ToolbarItem } from '../../lib/externalPlugins'
import { reportError } from '../../lib/errorLogging'
import { useRulerStore } from '../../stores/rulerStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTabStore } from '../../stores/tabStore'
import type { PluginSurface } from '../../types/plugin'
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

/** A button whose declarative action the host runs: it needs an open Markdown document. */
function ActionButton({ item, insert }: { item: ToolbarItem; insert?: (markdown: string) => void }) {
  const path = useTabStore((state) => state.active)
  const disabled = !path || !/\.md$/i.test(path)
  const markdown = item.action?.markdown
  const run = () => {
    try {
      if (markdown === undefined || !insert) throw new Error(`toolbar ${item.id}: no insert handler`)
      insert(markdown)
    } catch (error) {
      reportError('plugin.external.action', error instanceof Error ? error : new Error(String(error)))
    }
  }
  return <button type="button" className={styles.button} disabled={disabled} onClick={run}>{item.label}</button>
}

function ZoomSelect({ item, value, onSelect, disabled }: {
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

function EditorZoom({ item }: { item: ToolbarItem }) {
  const zoom = useSettingsStore((state) => state.zoom)
  const setZoom = useSettingsStore((state) => state.setZoom)
  return <ZoomSelect item={item} value={zoom} onSelect={setZoom} disabled={useBlocked(item)} />
}

function RulerToggle({ item }: { item: ToolbarItem }) {
  const visible = useRulerStore((state) => state.visible)
  const toggle = useRulerStore((state) => state.toggle)
  return (
    <button type="button" className={styles.toggle} aria-label={item.label} aria-pressed={visible}
      disabled={useBlocked(item)} onClick={toggle}>{item.label}</button>
  )
}

/** Preview-slot select bound to one preview surface. */
export function createPreviewZoom(item: ToolbarItem): ComponentType<{ surface: PluginSurface }> {
  return function PreviewZoom({ surface }) {
    return <ZoomSelect item={item} value={surface.zoom} onSelect={surface.setZoom} />
  }
}

/**
 * Renders a plugin's declared controls. The plugin supplies data only; every label is shown as
 * escaped text and the host decides the markup, so no plugin string is ever interpreted.
 * Bound controls read host stores directly and never go through the plugin bridge.
 */
export function createExternalToolbar(
  items: ToolbarItem[],
  send: (command: string, value: string | null) => void,
  insert?: (markdown: string) => void,
): ComponentType {
  return function ExternalToolbar() {
    return (
      <>
        {items.map((item) => {
          if (item.action) return item.action.type === 'insertMarkdown' && item.type === 'button' ? <ActionButton key={item.id} item={item} insert={insert} /> : null
          if (item.bind === 'zoom' && item.type === 'select') return <EditorZoom key={item.id} item={item} />
          if (item.bind === 'rulerVisible' && item.type === 'toggle') return <RulerToggle key={item.id} item={item} />
          const { command } = item
          if (item.bind || !command) return null
          return item.type === 'select' ? (
            <label key={item.id} className={styles.control}>
              {item.label}
              <select aria-label={item.label} defaultValue={item.options[0]?.value} onChange={(event) => send(command, event.target.value)}>
                {item.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          ) : item.type === 'button' ? (
            <button key={item.id} type="button" className={styles.button} onClick={() => send(command, null)}>{item.label}</button>
          ) : null
        })}
      </>
    )
  }
}
