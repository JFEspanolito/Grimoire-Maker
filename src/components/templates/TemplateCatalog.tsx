import { useState } from 'react'
import { useDocumentStore } from '../../stores/documentStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTemplateStore } from '../../stores/templateStore'
import { serializeDocument } from '../../lib/frontmatter'
import type { Template } from '../../lib/templates'
import { PAGE_SIZES } from '../../types/document'

function TemplateList({ items, onApply }: { items: Template[]; onApply: (t: Template) => void }) {
  return (
    <ul className="flex flex-col gap-1">
      {items.map((t) => (
        <li key={t.id}>
          <button className="text-sm hover:underline" onClick={() => onApply(t)}>
            {t.label}
          </button>
        </li>
      ))}
    </ul>
  )
}

/** Official presets plus community templates dropped into the user templates folder. */
export function TemplateCatalog() {
  const loadFromRaw = useDocumentStore((s) => s.loadFromRaw)
  const { templates, dir, errors } = useTemplateStore()
  const [open, setOpen] = useState(false)

  const official = templates.filter((t) => t.builtin)
  const community = templates.filter((t) => !t.builtin)

  const apply = (t: Template) => {
    loadFromRaw(null, serializeDocument(t.frontmatter, t.body))
    // The toolbar reads these settings, so a template's page setup must reach them too.
    const { pageSize, columns, theme } = t.frontmatter
    const settings = useSettingsStore.getState()
    if (pageSize && pageSize in PAGE_SIZES) settings.setPageSize(pageSize)
    if (columns === 1 || columns === 2) settings.setColumns(columns)
    if (typeof theme === 'string') settings.setTheme(theme)
  }

  return (
    <div className="border-t border-white/10 p-3">
      <button
        className="flex w-full items-center gap-1 text-xs font-semibold uppercase tracking-wide text-white/50 hover:text-white/80"
        aria-expanded={open}
        title={dir ? `Community templates folder: ${dir}` : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden>{open ? '▾' : '▸'}</span>
        Templates
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-2">
          <TemplateList items={official} onApply={apply} />
          {community.length > 0 && (
            <>
              <h3 className="text-xs uppercase tracking-wide text-white/40">Community</h3>
              <TemplateList items={community} onApply={apply} />
            </>
          )}
          {errors.length > 0 && (
            <p className="text-xs text-amber-400" title={errors.join('\n')}>
              {errors.length} template error{errors.length > 1 ? 's' : ''}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
