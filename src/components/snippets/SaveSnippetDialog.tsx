import { useEffect, useId, useRef, useState } from 'react'
import { friendlyErrorMessage, reportError } from '../../lib/errorLogging'
import { saveSnippetAndRefresh, snippetDraftProblem, useSnippetCategories } from './saveSnippet'
import styles from './SaveSnippetDialog.module.css'

interface Props {
  /** Markdown that becomes the snippet body. */
  markdown: string
  onClose: () => void
}

/** Small dialog that names a snippet and saves the given Markdown into the Snippets library. */
export function SaveSnippetDialog({ markdown, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const list = useId()
  const categories = useSnippetCategories()
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const element = dialog.current
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    element?.showModal()
    return () => { element?.close(); opener?.focus?.() }
  }, [])

  const save = async () => {
    const problem = snippetDraftProblem({ name, category, markdown })
    if (problem) { setError(problem); return }
    setSaving(true)
    setError('')
    try {
      await saveSnippetAndRefresh({ name, category, markdown })
      onClose()
    } catch (cause) {
      reportError('snippets.save', cause)
      setError(friendlyErrorMessage(cause, 'Could not save the snippet.'))
      setSaving(false)
    }
  }

  return (
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="save-snippet-title" onCancel={(event) => { event.preventDefault(); if (!saving) onClose() }}>
      <h2 id="save-snippet-title">Save as Snippet</h2>
      <label className={styles.field}>
        <span>Snippet Name</span>
        <input autoFocus value={name} maxLength={80} disabled={saving} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className={styles.field}>
        <span>Category / Folder</span>
        <input value={category} list={list} maxLength={60} disabled={saving} placeholder="General" onChange={(event) => setCategory(event.target.value)} />
        <datalist id={list}>{categories.map((item) => <option key={item} value={item} />)}</datalist>
      </label>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <footer className={styles.actions}>
        <button type="button" disabled={saving} onClick={onClose}>Cancel</button>
        <button type="button" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save to Snippets'}</button>
      </footer>
    </dialog>
  )
}
