import type { ComponentType } from 'react'
import type { ToolbarItem } from '../../lib/externalPlugins'
import { EditorZoom, RulerToggle, ZoomSelect } from './ExternalToolbarControls'
import type { PluginSurface } from '../../types/plugin'
import styles from './ExternalToolbar.module.css'

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
): ComponentType {
  return function ExternalToolbar() {
    return (
      <>
        {items.map((item) => {
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
