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
      setError(t('ui.choose_an_interval_between_1_second_and_24_hours_seconds_must_be_between_0_and_5'))
      setSaved(false)
      return
    }
    useSettingsStore.getState().setAutoSaveSeconds(total)
    setError(''); setSaved(true)
  }}>
    <h3>{t('preferences.section.autosave')}</h3>
    <p className={styles.description}>{t('pref.autosave.description')}</p>
    <div className={styles.autoSave}>
      <label>{t('pref.autosave.minutes')}<input type="number" min="0" max="1440" step="1" required value={minutes} onChange={event => { setMinutes(event.target.value); setSaved(false) }} /></label>
      <label>{t('pref.autosave.seconds')}<input type="number" min="0" max="59" step="1" required value={seconds} onChange={event => { setSeconds(event.target.value); setSaved(false) }} /></label>
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
      setError(t('ui.choose_an_interval_between_1_and_1440_minutes')); setSaved(false); return
    }
    if (!message.trim() || message.includes('\0') || new TextEncoder().encode(message).length > 4096) {
      setError(t('ui.enter_a_commit_message_of_1_4096_bytes_without_null_characters')); setSaved(false); return
    }
    useSettingsStore.getState().setAutoCommitSettings(enabled, Number(minutes), message)
    setError(''); setSaved(true)
  }}>
    <h3>{t('pref.autocommit.title')}</h3>
    <p className={styles.description}>{t('pref.autocommit.description')}</p>
    <label className={styles.autoCommitToggle}><input type="checkbox" checked={enabled} onChange={event => { setEnabled(event.target.checked); setSaved(false) }} />{t('pref.autocommit.enable')}</label>
    <div className={styles.autoSave}>
      <label>{t('pref.autosave.minutes')}<input type="number" min="1" max="1440" step="1" required value={minutes} onChange={event => { setMinutes(event.target.value); setSaved(false) }} /></label>
    </div>
    <label className={styles.autoCommitMessage}>{t('pref.autocommit.message')}<input required value={message} onChange={event => { setMessage(event.target.value); setSaved(false) }} /></label>
    <button type="submit">{t('common.save')}</button>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {saved && <p role="status" className={styles.notice}>{t('pref.autocommit.applied')}</p>}
  </form>
}
