import { useEffect, useRef, useState } from 'react'
import { useDocumentStore } from '../../stores/documentStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { documentLabel } from '../../lib/documentLabel'
import styles from './DocumentIndex.module.css'

interface Entry { level: 1 | 2 | 3; text: string; page: number; element: HTMLElement }

/** Reads the rendered headings so page numbers match the sheets the writer actually sees. */
function collectEntries(pane: HTMLElement): Entry[] {
  const sheets = Array.from(pane.querySelectorAll<HTMLElement>('[data-editor-sheet]'))
    .map((sheet) => sheet.getBoundingClientRect().top)
  return Array.from(pane.querySelectorAll<HTMLElement>('.ProseMirror h1, .ProseMirror h2, .ProseMirror h3'))
    .filter((heading) => heading.textContent?.trim())
    .map((element) => {
      const top = element.getBoundingClientRect().top
      const page = Math.max(1, sheets.filter((sheetTop) => sheetTop <= top + 1).length)
      return { level: Number(element.tagName[1]) as 1 | 2 | 3, text: element.textContent!.trim(), page, element }
    })
}

export function DocumentIndex({ path, visible }: { path: string | null; visible: boolean }) {
  const enabled = useSettingsStore((s) => s.showDocumentIndex)
  const body = useDocumentStore((s) => s.buffers[path ?? '__untitled__']?.body ?? (s.document.path === path ? s.document.body : ''))
  const title = useDocumentStore((s) => (s.buffers[path ?? '__untitled__'] ?? s.document).frontmatter.title)
  const anchor = useRef<HTMLDivElement>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const name = path ? documentLabel(path.split(/[\\/]/).pop()!) : title

  useEffect(() => {
    const pane = anchor.current?.parentElement
    if (!enabled || !visible || !pane) return
    const refresh = () => setEntries(collectEntries(pane))
    const frame = requestAnimationFrame(refresh)
    window.addEventListener('resize', refresh)
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', refresh) }
  }, [enabled, visible, body])

  if (!enabled) return null
  return <div ref={anchor} className={styles.anchor}>
    {entries.length > 0 && <nav className={styles.panel} aria-label="Document index">
      <h2>{name}</h2>
      <ol>
        {entries.map((entry, index) => <li key={index} data-level={entry.level}>
          <button type="button" onClick={() => entry.element.scrollIntoView({ block: 'start', behavior: 'smooth' })}>
            <span className={styles.text}>{entry.text}</span><span className={styles.page}>{entry.page}</span>
          </button>
        </li>)}
      </ol>
    </nav>}
  </div>
}
