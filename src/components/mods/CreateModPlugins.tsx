import { useId, useRef, useState } from 'react'
import { reportError } from '../../lib/errorLogging'
import { createPluginFromInput, hasPluginErrors, PLUGIN_LIMITS, validatePluginInput, type PluginInput } from '../../lib/pluginCreator'
import { useModStore } from '../../stores/modStore'
import { useToastStore } from '../../stores/toastStore'
import { useAction } from './createModShared'
import styles from './CreateMod.module.css'

export const PLUGIN_CREATED_MESSAGE = 'Plugin created. Find it in Mod Manager > Plugins.'
export const PLUGIN_CAPABILITY_SUMMARY = 'This plugin will be able to: insert the text you wrote when you press its buttons. It cannot read your pages, files or network.'

interface DraftButton { key: number; label: string; markdown: string }

/** Plugins tab: a no-code builder for plugins whose buttons only insert text you wrote. */
export function CreateModPlugins() {
  const ids = useId()
  const nextKey = useRef(2)
  const [name, setName] = useState('')
  const [author, setAuthor] = useState('')
  const [description, setDescription] = useState('')
  const [buttons, setButtons] = useState<DraftButton[]>([{ key: 1, label: '', markdown: '' }])
  // Problems appear after the first blur or the first submit, then follow the user as they type.
  const [showErrors, setShowErrors] = useState(false)
  const create = useAction()

  const input: PluginInput = {
    name: name.trim(),
    ...(author.trim() && { author: author.trim() }),
    ...(description.trim() && { description: description.trim() }),
    buttons: buttons.map((button) => ({ label: button.label.trim(), markdown: button.markdown })),
  }
  const errors = validatePluginInput(input)
  const shown = showErrors ? errors : null
  const reveal = () => setShowErrors(true)
  const update = (key: number, patch: Partial<DraftButton>) =>
    setButtons((list) => list.map((button) => (button.key === key ? { ...button, ...patch } : button)))

  const submit = () => {
    setShowErrors(true)
    if (hasPluginErrors(errors)) { create.setError('Fix the highlighted fields and try again.'); return }
    void create.run('mods.create.plugin', 'Could not create the plugin.', async () => {
      const created = await createPluginFromInput(input)
      setName('')
      setAuthor('')
      setDescription('')
      nextKey.current = 2
      setButtons([{ key: 1, label: '', markdown: '' }])
      setShowErrors(false)
      // The plugin is already on disk; a failed refresh must not report the creation as failed.
      await useModStore.getState().reload().catch((cause) => reportError('mods.create.plugin-reload', cause))
      useToastStore.getState().show(PLUGIN_CREATED_MESSAGE)
      return `Plugin "${input.name}" created in ${created.path}`
    })
  }

  const fieldError = (id: string, message?: string) => (message ? <span id={id} className={styles.error}>{message}</span> : null)

  return (
    <div className={styles.stack}>
      <section className={styles.block} aria-label="New plugin">
        <h4>New plugin</h4>
        <p className={styles.hint}>Make a plugin whose buttons insert text you wrote. It is saved to your Plugins library and turned on when you refresh Mod Manager.</p>
        <label className={styles.field}>
          <span>Plugin Name</span>
          <input value={name} required disabled={create.busy} aria-invalid={Boolean(shown?.name)}
            aria-describedby={shown?.name ? `${ids}-name` : undefined}
            onChange={(event) => setName(event.target.value)} onBlur={reveal} />
          {fieldError(`${ids}-name`, shown?.name)}
        </label>
        <label className={styles.field}>
          <span>Author</span>
          <input value={author} disabled={create.busy} aria-invalid={Boolean(shown?.author)}
            aria-describedby={shown?.author ? `${ids}-author` : undefined}
            onChange={(event) => setAuthor(event.target.value)} onBlur={reveal} />
          {fieldError(`${ids}-author`, shown?.author)}
        </label>
        <label className={styles.field}>
          <span>Description</span>
          <input value={description} disabled={create.busy} aria-invalid={Boolean(shown?.description)}
            aria-describedby={shown?.description ? `${ids}-description` : undefined}
            onChange={(event) => setDescription(event.target.value)} onBlur={reveal} />
          {fieldError(`${ids}-description`, shown?.description)}
        </label>

        <ol className={styles.buttonList} aria-label="Plugin buttons">
          {buttons.map((button, index) => {
            const problems = shown?.items[index]
            return (
              <li key={button.key} className={styles.buttonItem}>
                <div className={styles.buttonHeader}>
                  <strong>Button {index + 1}</strong>
                  <button type="button" disabled={create.busy || buttons.length <= 1} aria-label={`Remove button ${index + 1}`}
                    onClick={() => setButtons((list) => list.filter((item) => item.key !== button.key))}>Remove</button>
                </div>
                <label className={styles.field}>
                  <span>Button label</span>
                  <input value={button.label} disabled={create.busy} aria-invalid={Boolean(problems?.label)}
                    aria-describedby={problems?.label ? `${ids}-label-${button.key}` : undefined}
                    onChange={(event) => update(button.key, { label: event.target.value })} onBlur={reveal} />
                  {fieldError(`${ids}-label-${button.key}`, problems?.label)}
                </label>
                <label className={styles.field}>
                  <span>Markdown to insert</span>
                  <textarea className={styles.mono} rows={5} spellCheck={false} value={button.markdown} disabled={create.busy}
                    aria-invalid={Boolean(problems?.markdown)}
                    aria-describedby={problems?.markdown ? `${ids}-markdown-${button.key}` : undefined}
                    onChange={(event) => update(button.key, { markdown: event.target.value })} onBlur={reveal} />
                  {fieldError(`${ids}-markdown-${button.key}`, problems?.markdown)}
                </label>
              </li>
            )
          })}
        </ol>
        {shown?.buttons && <span className={styles.error}>{shown.buttons}</span>}
        <div className={styles.row}>
          <button type="button" disabled={create.busy || buttons.length >= PLUGIN_LIMITS.buttons}
            onClick={() => setButtons((list) => [...list, { key: nextKey.current++, label: '', markdown: '' }])}>Add button</button>
        </div>

        <p className={styles.summary} aria-label="What this plugin can do">{PLUGIN_CAPABILITY_SUMMARY}</p>
        <div className={styles.row}>
          <button type="button" className={styles.primary} disabled={create.busy} onClick={submit}>Create Plugin</button>
        </div>
        {create.busy && <p role="status">Creating…</p>}
        {create.status && <p role="status" className={styles.success}>{create.status}</p>}
        {create.error && <p role="alert" className={styles.error}>{create.error}</p>}
      </section>
    </div>
  )
}
