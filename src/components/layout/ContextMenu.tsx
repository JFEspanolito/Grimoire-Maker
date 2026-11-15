import { useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react'

interface Props {
  x: number
  y: number
  label: string
  onClose: (restoreFocus?: boolean) => void
  children: ReactNode
  className?: string
  style?: CSSProperties
}

const itemsIn = (menu: HTMLElement) => Array.from(menu.querySelectorAll<HTMLElement>(
  '[role="menuitem"]:not(:disabled):not([aria-disabled="true"])',
)).filter(item => !item.closest('[hidden], [aria-hidden="true"]'))

/** Shared pointer and keyboard behavior for the application's right-click menus. */
export function ContextMenu({ x, y, label, onClose, children, className, style }: Props) {
  const menu = useRef<HTMLDivElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)

  useLayoutEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const element = menu.current
    if (!element) return
    const items = itemsIn(element)
    items.forEach((item, index) => { item.tabIndex = index === 0 ? 0 : -1 })
    ;(items[0] ?? element).focus()
  }, [])

  useLayoutEffect(() => {
    const position = () => {
      const element = menu.current
      if (!element) return
      const width = Math.max(0, window.innerWidth - 8)
      const height = Math.max(0, window.innerHeight - 8)
      element.style.maxWidth = `${width}px`
      element.style.maxHeight = `${height}px`
      element.style.overflow = 'auto'
      const rect = element.getBoundingClientRect()
      if (rect.width > width) element.style.minWidth = '0'
      element.style.left = `${Math.max(4, Math.min(x, window.innerWidth - Math.min(rect.width, width) - 4))}px`
      element.style.top = `${Math.max(4, Math.min(y, window.innerHeight - Math.min(rect.height, height) - 4))}px`
    }
    position()
    window.addEventListener('resize', position)
    return () => window.removeEventListener('resize', position)
  }, [x, y])

  const close = (restoreFocus = false) => {
    if (restoreFocus && previousFocus.current?.isConnected) previousFocus.current.focus()
    onClose(restoreFocus)
  }

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) close()
    }
    const blur = () => close()
    const key = (event: KeyboardEvent) => {
      const element = menu.current
      if (!element || event.defaultPrevented) return
      if (event.key === 'Escape' || event.key === 'Tab') {
        event.preventDefault(); event.stopPropagation(); close(true); return
      }
      if (!element.contains(document.activeElement)) return
      const items = itemsIn(element)
      const index = items.indexOf(document.activeElement as HTMLElement)
      const target = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : event.key === 'ArrowDown' ? (index + 1) % items.length
          : event.key === 'ArrowUp' ? (index - 1 + items.length) % items.length : -1
      if (target < 0 || !items[target]) return
      event.preventDefault(); event.stopPropagation()
      items.forEach((item, current) => { item.tabIndex = current === target ? 0 : -1 })
      items[target].focus()
      items[target].scrollIntoView?.({ block: 'nearest' })
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', key, true)
    window.addEventListener('blur', blur)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('keydown', key, true)
      window.removeEventListener('blur', blur)
    }
  })

  return <div ref={menu} role="menu" aria-label={label} tabIndex={-1} className={className}
    style={{ ...style, position: 'fixed', left: x, top: y }}
    onPointerDown={event => event.stopPropagation()}
    onContextMenu={event => { event.preventDefault(); event.stopPropagation() }}
    onFocus={event => {
      if (menu.current) itemsIn(menu.current).forEach(item => { item.tabIndex = item === event.target ? 0 : -1 })
    }}
    onClickCapture={event => {
      if (event.target instanceof Element && event.target.closest('[role="menuitem"]:not(:disabled):not([aria-disabled="true"])')) close(true)
    }}>{children}</div>
}
