import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { validateContributors, type Contributor, type ContributorGroup } from '../../lib/projectContributors'
import { useTranslation } from '../../lib/i18n'
import styles from './ContributorsDialog.module.css'

interface Props {
  title: string
  group?: ContributorGroup
  initial: Contributor[]
  busy: boolean
  error: string
  onSave: (contributors: Contributor[]) => Promise<boolean>
  onClose: () => void
}

export function ContributorsDialog({ title, group, initial, busy, error, onSave, onClose }: Props) {
  const { t } = useTranslation()
  const dialog = useRef<HTMLDialogElement>(null)
  const [rows, setRows] = useState(() => initial.map(value => ({ id: crypto.randomUUID(), value })))
  const [validation, setValidation] = useState('')
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])
  const isArtist = group === 'artists' || title.toLowerCase().includes('artist')
  const addLabel = isArtist ? t('contributors.addArtist') : t('contributors.addCoAuthor')
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
      <header><h2 id="contributors-title">{title}</h2><button type="button" aria-label={t('contributors.cancelAria')} disabled={busy} onClick={onClose}>{t('common.cancel')}</button></header>
      <p>{t('contributors.description')}</p>
      <div className={styles.scroll}><table>
        <thead><tr><th scope="col">{t('contributors.name')}</th><th scope="col">{t('contributors.socialMedia')}</th><th scope="col">{t('contributors.platform')}</th><th scope="col">{t('contributors.actions')}</th></tr></thead>
        <tbody>{rows.map((row, index) => <tr key={row.id}>
          {(['name', 'socialMedia', 'platform'] as const).map((key, column) => <td key={key}>
            <input aria-label={`${[t('contributors.name'), t('contributors.socialMedia'), t('contributors.platform')][column]} ${index + 1}`} value={row.value[key]}
              required={key === 'name'} maxLength={500} disabled={busy} placeholder={['Midrava', '@midrava', 'Instagram'][column]}
              onChange={event => { setValidation(''); setRows(current => current.map(item => item.id === row.id ? { ...item, value: { ...item.value, [key]: event.target.value } } : item)) }} />
          </td>)}
          <td><button type="button" aria-label={`${t('contributors.removeContributor')} ${index + 1}`} disabled={busy}
            onClick={() => setRows(current => current.filter(item => item.id !== row.id))}>{t('contributors.remove')}</button></td>
        </tr>)}</tbody>
      </table></div>
      {!rows.length && <p>{t('contributors.empty')}</p>}
      {(validation || error) && <p role="alert">{validation || error}</p>}
      <footer><button type="button" aria-label={addLabel} disabled={busy || rows.length >= 100}
        onClick={() => setRows(current => [...current, { id: crypto.randomUUID(), value: { name: '', socialMedia: '', platform: '' } }])}>{addLabel}</button>
        <button type="submit" disabled={busy}>{busy ? t('contributors.saving') : t('common.save')}</button></footer>
    </form>
  </dialog>, document.body)
}
