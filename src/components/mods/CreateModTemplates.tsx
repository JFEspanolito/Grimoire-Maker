import { useState } from 'react'
import { exportProjectAsTemplate } from '../../lib/modExport'
import { bookName } from '../../lib/themeHeaderFooter'
import { useDocumentStore } from '../../stores/documentStore'
import { savedMessage, useAction } from './createModShared'
import styles from './CreateMod.module.css'

/** Templates tab: turns the open project into a shareable template package. */
export function CreateModTemplates() {
  const workspace = useDocumentStore((state) => state.workspaceRoot)
  const project = workspace ? bookName(workspace) : ''
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [author, setAuthor] = useState('')
  const [includeContent, setIncludeContent] = useState(true)
  const [warnings, setWarnings] = useState<string[]>([])
  const { busy, status, error, setError, run } = useAction()
  const locked = busy || !workspace

  const exportTemplate = () => {
    if (!name.trim()) { setError('Enter a template name.'); return }
    setWarnings([])
    void run('mods.create.template-export', 'Could not export the project as a template.', async () => {
      const result = await exportProjectAsTemplate({
        name: name.trim(),
        ...(description.trim() && { description: description.trim() }),
        ...(author.trim() && { author: author.trim() }),
        includeContent,
      })
      if (!result) return ''
      setWarnings(result.warnings ?? [])
      return savedMessage('Template', result)
    })
  }

  return (
    <div className={styles.stack}>
      {workspace
        ? <p className={styles.workspace}>Grimorio activo: {project}</p>
        : <p className={styles.hint}>Open a project folder to export it as a template.</p>}
      <label className={styles.field}>
        <span>Template Name</span>
        <input value={name} maxLength={80} required disabled={locked} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className={styles.field}>
        <span>Description</span>
        <textarea rows={3} value={description} maxLength={500} disabled={locked} onChange={(event) => setDescription(event.target.value)} />
      </label>
      <label className={styles.field}>
        <span>Author</span>
        <input value={author} maxLength={80} disabled={locked} onChange={(event) => setAuthor(event.target.value)} />
      </label>
      <fieldset className={styles.choices} disabled={locked}>
        <legend>What to include</legend>
        <label><input type="radio" name="template-contents" checked={includeContent} onChange={() => setIncludeContent(true)} /> Incluir contenido de los archivos</label>
        <label><input type="radio" name="template-contents" checked={!includeContent} onChange={() => setIncludeContent(false)} /> Solo estructura de carpetas y archivos en blanco</label>
      </fieldset>
      <div className={styles.row}>
        <button type="button" className={styles.primary} disabled={locked} onClick={exportTemplate}>Export Current Project as Template</button>
      </div>
      {busy && <p role="status">Exporting…</p>}
      {status && <p role="status" className={styles.success}>{status}</p>}
      {warnings.length > 0 && (
        <details className={styles.warnings}>
          <summary>Details ({warnings.length} {warnings.length === 1 ? 'note' : 'notes'})</summary>
          <ul>{warnings.map((warning, index) => <li key={`${index}:${warning}`}>{warning}</li>)}</ul>
        </details>
      )}
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </div>
  )
}
