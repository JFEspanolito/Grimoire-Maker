import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePluginRegistry } from '../../plugins/plugin-manager'
import type { PluginContextAction, PluginContextActionContext } from '../../types/plugin'
import { useTabStore } from '../../stores/tabStore'
import { ContextMenu } from './ContextMenu'

interface MenuState {
  x: number
  y: number
  actions: PluginContextAction[]
  context: PluginContextActionContext
}

export function PluginContextMenu() {
  const [menu, setMenu] = useState<MenuState | null>(null)
  const contextActions = usePluginRegistry((state) => state.contextActions)

  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable="true"], .ProseMirror')) return

      const selectionText = window.getSelection()?.toString().trim() ?? ''
      const path = useTabStore.getState().active

      const ctx: PluginContextActionContext = {
        target: e.target as Element,
        selectionText,
        path,
        x: e.clientX,
        y: e.clientY,
      }

      const activeActions = contextActions.filter((action) => {
        try {
          return !action.when || action.when(ctx)
        } catch {
          return false
        }
      })

      if (activeActions.length > 0) {
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY, actions: activeActions, context: ctx })
      } else {
        setMenu(null)
      }
    }

    window.addEventListener('contextmenu', handleContextMenu)

    return () => {
      window.removeEventListener('contextmenu', handleContextMenu)
    }
  }, [contextActions])

  if (!menu) return null

  return createPortal(
    <ContextMenu
      label="Context Actions"
      x={menu.x} y={menu.y} onClose={() => setMenu(null)}
      style={{
        zIndex: 9999,
      }}
      className="min-w-44 rounded-md border border-[#4a4539] bg-[#22201d] p-1 shadow-2xl shadow-black/80 font-sans text-xs text-[#f0eee9]"
    >
      {menu.actions.map((action) => (
        <button
          key={action.id}
          type="button"
          role="menuitem"
          className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-xs font-medium text-[#f0eee9] transition-colors hover:bg-white/10 focus:bg-white/10 focus:outline-none"
          onClick={() => {
            try {
              action.run(menu.context)
            } catch (err) {
              console.error('Error running context action:', err)
            }
            setMenu(null)
          }}
        >
          {action.id === 'quotes.add' && <span aria-hidden="true">❝</span>}
          {action.id === 'bookmarks.add' && <span aria-hidden="true">🔖</span>}
          {action.label}
        </button>
      ))}
    </ContextMenu>,
    document.body
  )
}
