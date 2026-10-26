import type { ComponentType } from 'react'
import type { ToolbarItem } from '../../lib/externalPlugins'
import styles from './ExternalToolbar.module.css'

/**
 * Renders a plugin's declared controls. The plugin supplies data only; every label is shown as
 * escaped text and the host decides the markup, so no plugin string is ever interpreted.
 */
export function createExternalToolbar(
  items: ToolbarItem[],
  send: (command: string, value: string | null) => void,
): ComponentType {
  return function ExternalToolbar() {
    return (
      <>
        {items.map((item) => item.type === 'select' ? (
          <label key={item.id} className={styles.control}>
            {item.label}
            <select aria-label={item.label} defaultValue={item.options[0]?.value} onChange={(event) => send(item.command, event.target.value)}>
              {item.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        ) : (
          <button key={item.id} type="button" className={styles.control} onClick={() => send(item.command, null)}>{item.label}</button>
        ))}
      </>
    )
  }
}
