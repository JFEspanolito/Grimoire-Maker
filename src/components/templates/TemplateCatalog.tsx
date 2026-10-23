import { useState } from 'react'
import { useDocumentStore } from '../../stores/documentStore'
import type { Frontmatter } from '../../types/document'

interface Template {
  id: string
  label: string
  frontmatter: Frontmatter
  body: string
}

const OFFICIAL_TEMPLATES: Template[] = [
  {
    id: 'classic-fantasy',
    label: 'Classic Fantasy',
    frontmatter: { title: 'Untitled Adventure', pageSize: 'a4', columns: 2, theme: 'parchment' },
    body: '# Chapter One\n\nBegin here.\n',
  },
  {
    id: 'quick-one-shot',
    label: 'Quick One-Shot (5 pages)',
    frontmatter: { title: 'Untitled One-Shot', pageSize: 'letter', columns: 2, theme: 'modern' },
    body: '# The Hook\n\n# The Location\n\n# The Encounter\n\n# The Reward\n',
  },
  {
    id: 'a5-zine',
    label: 'A5 Folded Zine',
    frontmatter: { title: 'Untitled Zine', pageSize: 'b5', columns: 1, theme: 'dark-fantasy' },
    body: '# Zine Title\n',
  },
]

/** Official presets only; zip/folder community templates are a later milestone. */
export function TemplateCatalog() {
  const loadFromRaw = useDocumentStore((s) => s.loadFromRaw)
  const [open, setOpen] = useState(false)
  const apply = (t: Template) => {
    const yaml = Object.entries(t.frontmatter)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n')
    loadFromRaw(null, `---\n${yaml}\n---\n${t.body}`)
  }

  return (
    <div className="border-t border-white/10 p-3">
      <button
        className="flex w-full items-center gap-1 text-xs font-semibold uppercase tracking-wide text-white/50 hover:text-white/80"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden>{open ? '▾' : '▸'}</span>
        Templates
      </button>
      {open && (
        <ul className="mt-2 flex flex-col gap-1">
          {OFFICIAL_TEMPLATES.map((t) => (
            <li key={t.id}>
              <button className="text-sm hover:underline" onClick={() => apply(t)}>
                {t.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
