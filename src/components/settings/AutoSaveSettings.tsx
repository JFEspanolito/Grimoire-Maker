import { useState } from 'react'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTranslation } from '../../lib/i18n'
import styles from './PreferencesDialog.module.css'

export function AutoSaveSettings() {
  const { t } = useTranslation()
  const interval = useSettingsStore(state => state.autoSaveSeconds)
  const [minutes, setMinutes] = useState(String(Math.floor(interval / 60)))
  const [seconds, setSeconds] = useState(String(interval % 60))
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  return <><form onSubmit={event => {
    event.preventDefault()
    const total = Number(minutes) * 60 + Number(seconds)
    if (!/^\d+$/.test(minutes) || !/^\d+$/.test(seconds) || Number(seconds) > 59 || total < 1 || total > 86400) {
      setError('Choose an interval between 1 second and 24 hours. Seconds must be between 0 and 59.')
      setSaved(false)
      return
    }
    useSettingsStore.getState().setAutoSaveSeconds(total)
    setError(''); setSaved(true)
  }}>
    <h3>{t('preferences.section.autosave')}</h3>
    <p className={styles.description}>{t('pref.autosave.description')}</p>
    <div className={styles.autoSave}>
      <label>{t('pref.autosave.minutes')}<input aria-label="Auto save minutes" type="number" min="0" max="1440" step="1" required value={minutes} onChange={event => { setMinutes(event.target.value); setSaved(false) }} /></label>
      <label>{t('pref.autosave.seconds')}<input aria-label="Auto save seconds" type="number" min="0" max="59" step="1" required value={seconds} onChange={event => { setSeconds(event.target.value); setSaved(false) }} /></label>
      <button type="submit">{t('pref.autosave.apply')}</button>
    </div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {saved && <p role="status" className={styles.notice}>{t('pref.autosave.applied')}</p>}
  </form><AutoCommitSettings /></>
}


function AutoCommitSettings() {
  const { t } = useTranslation()
  const settings = useSettingsStore.getState()
  const [enabled, setEnabled] = useState(settings.autoCommitEnabled)
  const [minutes, setMinutes] = useState(String(settings.autoCommitMinutes))
  const [message, setMessage] = useState(settings.autoCommitMessage)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  return <form className={styles.autoCommit} onSubmit={event => {
    event.preventDefault()
    if (!/^\d+$/.test(minutes) || Number(minutes) < 1 || Number(minutes) > 1440) {
      setError('Choose an interval between 1 and 1440 minutes.'); setSaved(false); return
    }
    if (!message.trim() || message.includes('\0') || new TextEncoder().encode(message).length > 4096) {
      setError('Enter a commit message of 1–4096 bytes without null characters.'); setSaved(false); return
    }
    useSettingsStore.getState().setAutoCommitSettings(enabled, Number(minutes), message)
    setError(''); setSaved(true)
  }}>
    <h3>{t('pref.autocommit.title')}</h3>
    <p className={styles.description}>{t('pref.autocommit.description')}</p>
    <label className={styles.autoCommitToggle}><input aria-label="Enable auto commits" type="checkbox" checked={enabled} onChange={event => { setEnabled(event.target.checked); setSaved(false) }} />{t('pref.autocommit.enable')}</label>
    <div className={styles.autoSave}>
      <label>{t('pref.autosave.minutes')}<input aria-label="Auto commit minutes" type="number" min="1" max="1440" step="1" required value={minutes} onChange={event => { setMinutes(event.target.value); setSaved(false) }} /></label>
    </div>
    <label className={styles.autoCommitMessage}>{t('pref.autocommit.message')}<input aria-label="Auto commit message" required value={message} onChange={event => { setMessage(event.target.value); setSaved(false) }} /></label>
    <button type="submit">{t('common.save')}</button>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {saved && <p role="status" className={styles.notice}>{t('pref.autocommit.applied')}</p>}
  </form>
}
