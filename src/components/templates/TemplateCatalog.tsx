import { reportError } from '../../lib/errorLogging'
import { useState } from 'react'
import { useTemplateStore } from '../../stores/templateStore'
import { exportTemplateZip } from '../../lib/templateActions'
import type { Template } from '../../lib/templates'
import { useFileSystem } from '../../hooks/useFileSystem'
import { useDocumentStore } from '../../stores/documentStore'
import { ConfirmDialog } from '../layout/ConfirmDialog'
import { useTranslation } from '../../lib/i18n'

function TemplateList({
  items,
  onApply,
  onExport,
}: {
  items: Template[]
  onApply: (t: Template) => void
  onExport?: (t: Template) => void
}) {
  const { t } = useTranslation()
  return (
    <ul className="flex flex-col gap-2">
      {items.map((template) => (
        <li key={template.id} className="flex items-center justify-between gap-2 rounded px-1.5 py-1 transition-colors hover:bg-white/5">
          <button className="text-left text-sm leading-snug hover:underline" onClick={() => onApply(template)}>
            {template.label}
          </button>
          {onExport && (
            <button
              className="shrink-0 text-xs text-white/50 hover:text-white"
              title={t('templates.export')}
              aria-label={`Export ${template.label}`}
              onClick={() => onExport(template)}
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
  const { t } = useTranslation()
  const { applyTemplate, createProject } = useFileSystem()
  const hasProject = useDocumentStore((state) => state.workspaceRoot !== null)
  const { templates, dir, errors } = useTemplateStore()
  const [manualOpen, setManualOpen] = useState<{ hasProject: boolean; open: boolean } | null>(null)
  const open = manualOpen?.hasProject === hasProject ? manualOpen.open : !hasProject
  const [notice, setNotice] = useState<Notice | null>(null)
  const [pendingTemplate, setPendingTemplate] = useState<Template | null>(null)

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

  const exportZip = (t: Template) =>
    run(async () => ((await exportTemplateZip(t)) ? `Exported "${t.label}"` : null))

  const apply = (template: Template, replaceExisting = false) => {
    setPendingTemplate(null)
    void run(async () => {
      if (!hasProject && template.location?.kind === 'package' && template.requiresProject !== false) {
        const folderName = template.label.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'My Grimoire'
        if (!(await createProject(folderName))) return null
        return (await applyTemplate(template, { replaceExisting: true }))
          ? `Created project with "${template.label}"`
          : null
      }
      return (await applyTemplate(template, { replaceExisting }))
        ? replaceExisting ? `Replaced Draft with "${template.label}"` : `Applied "${template.label}"`
        : null
    })
  }

  return (
    <div className="border-t border-white/10 p-3">
      <button
        className="flex w-full items-center gap-1 text-xs font-semibold uppercase tracking-wide text-white/50 hover:text-white/80"
        aria-expanded={open}
        title={dir ? t('templates.hint') : undefined}
        onClick={() => setManualOpen({ hasProject, open: !open })}
      >
        <span aria-hidden>{open ? '▾' : '▸'}</span>
        Templates
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-2">
          <TemplateList items={templates} onApply={setPendingTemplate} onExport={(t) => void exportZip(t)} />
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
            : 'No hay un proyecto abierto. Elige una carpeta donde crear el proyecto para aplicar esta plantilla.'}
          cancelLabel="Cancelar"
          secondaryLabel={hasProject ? 'Añadir esto al proyecto actual' : 'Elegir carpeta y crear proyecto'}
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
