import { ContextMenu } from '../layout/ContextMenu'
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
  return (
    <ContextMenu className={styles.menu} label="Editor actions" x={x} y={y} onClose={onClose}>
      {items.map((item) => (
        <button key={item.id} type="button" role="menuitem" onClick={item.run}>{item.label}</button>
      ))}
    </ContextMenu>
  )
}
