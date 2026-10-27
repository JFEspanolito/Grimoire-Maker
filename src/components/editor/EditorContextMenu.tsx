import { useEffect, useRef } from 'react'
import styles from './EditorContextMenu.module.css'

export interface EditorMenuItem {
  id: string
  label: string
  run: () => void
}

interface Props {
  x: number
  y: number
  items: EditorMenuItem[]
  /** `restoreFocus` is true when the user chose an item or pressed Escape, so the editor should get the caret back. */
  onClose: (restoreFocus?: boolean) => void
}

/** The page editor's single right-click menu: host items and plugin items in one list. */
export function EditorContextMenu({ x, y, items, onClose }: Props) {
  const menu = useRef<HTMLDivElement>(null)
  useEffect(() => {
    menu.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const close = (event: Event) => { if (!menu.current?.contains(event.target as Node)) onClose() }
    const blur = () => onClose()
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(true) }
    document.addEventListener('pointerdown', close, true)
    document.addEventListener('keydown', key)
    window.addEventListener('blur', blur)
    return () => {
      document.removeEventListener('pointerdown', close, true)
      document.removeEventListener('keydown', key)
      window.removeEventListener('blur', blur)
    }
  }, [onClose])
  return (
    <div ref={menu} className={styles.menu} role="menu" aria-label="Editor actions" style={{ left: x, top: y }}>
      {items.map((item) => (
        <button key={item.id} type="button" role="menuitem" onClick={() => { onClose(true); item.run() }}>{item.label}</button>
      ))}
    </div>
  )
}
