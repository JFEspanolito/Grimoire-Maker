import { reportError } from '../../lib/errorLogging'
import { useState } from 'react'
import { useTemplateStore } from '../../stores/templateStore'
import { exportTemplateZip, importTemplateZip } from '../../lib/templateActions'
import type { Template } from '../../lib/templates'
import { isTauri, useFileSystem } from '../../hooks/useFileSystem'
import { useDocumentStore } from '../../stores/documentStore'
import { ConfirmDialog } from '../layout/ConfirmDialog'

function TemplateList({
  items,
  onApply,
  onExport,
}: {
  items: Template[]
  onApply: (t: Template) => void
  onExport?: (t: Template) => void
}) {
  return (
    <ul className="flex flex-col gap-1">
      {items.map((t) => (
        <li key={t.id} className="flex items-center justify-between gap-2">
          <button className="text-left text-sm hover:underline" onClick={() => onApply(t)}>
            {t.label}
          </button>
          {onExport && (
            <button
              className="shrink-0 text-xs text-white/50 hover:text-white"
              title="Export template"
              aria-label={`Export ${t.label}`}
              onClick={() => onExport(t)}
            >
              ⤓
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

type Notice = { kind: 'ok' | 'error'; text: string }

/** Browser presets plus enabled folder templates, including compatible legacy packages. */
export function TemplateCatalog() {
  const { applyTemplate } = useFileSystem()
  const hasProject = useDocumentStore((state) => state.workspaceRoot !== null)
  const { templates, dir, errors, reload } = useTemplateStore()
  const [open, setOpen] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [pendingTemplate, setPendingTemplate] = useState<Template | null>(null)

  const official = templates.filter((t) => t.builtin)
  const community = templates.filter((t) => !t.builtin)

  /** Runs a file action; a returned string is shown as the result, null means it was cancelled. */
  const run = async (action: () => Promise<string | null>) => {
    try {
      const text = await action()
      setNotice(text ? { kind: 'ok', text } : null)
    } catch (e) {
      reportError('templates.action', e)
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : String(e) })
    }
  }

  const importZip = () =>
    run(async () => {
      const id = await importTemplateZip()
      if (!id) return null
      await reload()
      return `Imported "${id}"`
    })

  const exportZip = (t: Template) =>
    run(async () => ((await exportTemplateZip(t)) ? `Exported "${t.label}"` : null))

  const apply = (template: Template, replaceExisting = false) => {
    setPendingTemplate(null)
    void run(async () =>
      (await applyTemplate(template, { replaceExisting }))
        ? replaceExisting ? `Replaced Draft with "${template.label}"` : `Applied "${template.label}"`
        : null)
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
          <TemplateList items={official} onApply={setPendingTemplate} onExport={(t) => void exportZip(t)} />
          {community.length > 0 && (
            <>
              <h3 className="text-xs uppercase tracking-wide text-white/40">Installed</h3>
              <TemplateList items={community} onApply={setPendingTemplate} onExport={(t) => void exportZip(t)} />
            </>
          )}
          {isTauri() && (
            <button className="self-start text-xs underline" onClick={() => void importZip()}>
              Import…
            </button>
          )}
          {notice && (
            <p className={`text-xs ${notice.kind === 'error' ? 'text-red-400' : 'text-emerald-400'}`}>
              {notice.text}
            </p>
          )}
          {errors.length > 0 && (
            <p className="text-xs text-amber-400" title={errors.join('\n')}>
              {errors.length} template error{errors.length > 1 ? 's' : ''}
            </p>
          )}
        </div>
      )}
      {pendingTemplate && (
        <ConfirmDialog
          title={`Usar "${pendingTemplate.label}"`}
          message={hasProject
            ? 'Añadir conserva los documentos actuales. Reemplazar mueve todo Draft a Trash antes de aplicar la plantilla.'
            : 'No hay un proyecto abierto. Puedes usar la plantilla en el editor; abre un proyecto para reemplazar su Draft.'}
          cancelLabel="Cancelar"
          secondaryLabel={hasProject ? 'Añadir esto al proyecto actual' : 'Usar plantilla sin proyecto'}
          confirmLabel="Reemplazar existente"
          danger
          confirmDisabled={!hasProject}
          onCancel={() => setPendingTemplate(null)}
          onSecondary={() => apply(pendingTemplate)}
          onConfirm={() => apply(pendingTemplate, true)}
        />
      )}
    </div>
  )
}
