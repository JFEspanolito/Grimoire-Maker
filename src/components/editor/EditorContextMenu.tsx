import { useEffect, useRef } from 'react'
import styles from './EditorContextMenu.module.css'

interface Props {
  x: number
  y: number
  onSaveSnippet: () => void
  onClose: () => void
}

/** Small right-click menu of the page editor. Closes on Escape, outside click, scroll or after a choice. */
export function EditorContextMenu({ x, y, onSaveSnippet, onClose }: Props) {
  const menu = useRef<HTMLDivElement>(null)
  useEffect(() => {
    menu.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const close = (event: Event) => { if (!menu.current?.contains(event.target as Node)) onClose() }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('pointerdown', close, true)
    document.addEventListener('keydown', key)
    window.addEventListener('blur', onClose)
    return () => {
      document.removeEventListener('pointerdown', close, true)
      document.removeEventListener('keydown', key)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])
  return (
    <div ref={menu} className={styles.menu} role="menu" aria-label="Editor actions" style={{ left: x, top: y }}>
      <button type="button" role="menuitem" onClick={() => { onClose(); onSaveSnippet() }}>Save Selection as Snippet...</button>
    </div>
  )
}
