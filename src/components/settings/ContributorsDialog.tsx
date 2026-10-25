import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { validateContributors, type Contributor } from '../../lib/projectContributors'
import styles from './ContributorsDialog.module.css'

interface Props {
  title: string
  initial: Contributor[]
  busy: boolean
  error: string
  onSave: (contributors: Contributor[]) => Promise<boolean>
  onClose: () => void
}

export function ContributorsDialog({ title, initial, busy, error, onSave, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [rows, setRows] = useState(() => initial.map(value => ({ id: crypto.randomUUID(), value })))
  const [validation, setValidation] = useState('')
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])
  return createPortal(<dialog ref={dialog} className={styles.dialog} aria-labelledby="contributors-title"
    onCancel={event => { event.preventDefault(); event.stopPropagation(); if (!busy) onClose() }}>
    <form onSubmit={async event => {
      event.preventDefault(); event.stopPropagation()
      if (busy) return
      setValidation('')
      try {
        if (await onSave(validateContributors(rows.map(row => row.value)))) onClose()
      } catch (cause) { setValidation(cause instanceof Error ? cause.message : String(cause)) }
    }}>
      <header><h2 id="contributors-title">{title}</h2><button type="button" aria-label="Cancel contributors" disabled={busy} onClick={onClose}>Cancel</button></header>
      <p>Project credits. Add a name, social media handle or URL, and platform.</p>
      <div className={styles.scroll}><table>
        <thead><tr><th scope="col">Name</th><th scope="col">Social media</th><th scope="col">Platform</th><th scope="col">Actions</th></tr></thead>
        <tbody>{rows.map((row, index) => <tr key={row.id}>
          {(['name', 'socialMedia', 'platform'] as const).map((key, column) => <td key={key}>
            <input aria-label={`${['Name', 'Social media', 'Platform'][column]} ${index + 1}`} value={row.value[key]}
              required={key === 'name'} maxLength={500} disabled={busy} placeholder={['Midrava', '@midrava', 'Instagram'][column]}
              onChange={event => { setValidation(''); setRows(current => current.map(item => item.id === row.id ? { ...item, value: { ...item.value, [key]: event.target.value } } : item)) }} />
          </td>)}
          <td><button type="button" aria-label={`Remove contributor ${index + 1}`} disabled={busy}
            onClick={() => setRows(current => current.filter(item => item.id !== row.id))}>Remove</button></td>
        </tr>)}</tbody>
      </table></div>
      {!rows.length && <p>No contributors yet.</p>}
      {(validation || error) && <p role="alert">{validation || error}</p>}
      <footer><button type="button" aria-label={title === 'Artist' ? 'Add artist' : 'Add co-author'} disabled={busy || rows.length >= 100}
        onClick={() => setRows(current => [...current, { id: crypto.randomUUID(), value: { name: '', socialMedia: '', platform: '' } }])}>{title === 'Artist' ? 'Add artist' : 'Add co-author'}</button>
        <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></footer>
    </form>
  </dialog>, document.body)
}
