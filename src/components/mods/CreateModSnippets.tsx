import { useId, useState } from 'react'
import { friendlyErrorMessage, reportError } from '../../lib/errorLogging'
import { exportSnippetPackFrom } from '../../lib/modExport'
import { saveSnippetAndRefresh, snippetDraftProblem, useSnippetCategories } from '../snippets/saveSnippet'
import { savedMessage, useAction } from './createModShared'
import { useTranslation } from '../../lib/i18n'
import styles from './CreateMod.module.css'

/** Snippets tab: write a new snippet. Saving adds it to the Snippets library and then offers its zip package. */
export function CreateModSnippets() {
  const { t } = useTranslation()
  const categories = useSnippetCategories()
  const list = useId()
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [markdown, setMarkdown] = useState('')
  const create = useAction()

  const save = () => {
    const problem = snippetDraftProblem({ name, category, markdown })
    if (problem) { create.setError(problem); return }
    const draft = { name: name.trim(), category: category.trim(), markdown }
    void create.run('mods.create.snippet-save', 'Could not save the snippet.', async () => {
      // Step 1: the library save. A failure here stops everything and nothing is packaged.
      const path = await saveSnippetAndRefresh(draft)
      setName('')
      setMarkdown('')
      // Step 2: the zip. The snippet is already in the library, so a cancelled or failed zip never undoes it.
      try {
        const zip = await exportSnippetPackFrom([draft])
        if (!zip) return `Snippet added to your library (${path}). The zip was not saved.`
        return `Snippet added to your library (${path}). ${savedMessage('Zip', zip)}`
      } catch (cause) {
        reportError('mods.create.snippet-pack', cause)
        create.setError(`The snippet was added to your library, but the zip could not be saved. ${friendlyErrorMessage(cause, 'Try again from Export.')}`)
        return `Snippet added to your library (${path}).`
      }
    })
  }

  return (
    <div className={styles.stack}>
      <section className={styles.block} aria-label={t('createMod.newSnippet')}>
        <h4>{t('createMod.newSnippet')}</h4>
        <p className={styles.hint}>{t('createMod.snippetHint')}</p>
        <label className={styles.field}>
          <span>{t('createMod.snippetName')}</span>
          <input value={name} maxLength={80} disabled={create.busy} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className={styles.field}>
          <span>{t('createMod.categoryFolder')}</span>
          <input value={category} list={list} maxLength={60} placeholder="General" disabled={create.busy} onChange={(event) => setCategory(event.target.value)} />
          <datalist id={list}>{categories.map((item) => <option key={item} value={item} />)}</datalist>
        </label>
        <label className={styles.field}>
          <span>{t('createMod.markdown')}</span>
          <textarea className={styles.mono} rows={8} spellCheck={false} value={markdown}
            disabled={create.busy} onChange={(event) => setMarkdown(event.target.value)} />
        </label>
        <div className={styles.row}>
          <button type="button" className={styles.primary} disabled={create.busy} onClick={save}>{t('createMod.saveToSnippets')}</button>
        </div>
        {create.status && <p role="status" className={styles.success}>{create.status}</p>}
        {create.error && <p role="alert" className={styles.error}>{create.error}</p>}
      </section>
    </div>
  )
}
