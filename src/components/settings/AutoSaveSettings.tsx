import { useState } from 'react'
import { useSettingsStore } from '../../stores/settingsStore'
import styles from './PreferencesDialog.module.css'

export function AutoSaveSettings() {
  const interval = useSettingsStore(state => state.autoSaveSeconds)
  const [minutes, setMinutes] = useState(String(Math.floor(interval / 60)))
  const [seconds, setSeconds] = useState(String(interval % 60))
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  return <form onSubmit={event => {
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
    <h3>Auto save</h3>
    <p className={styles.description}>Save modified pages automatically. New pages without a file path need to be saved once manually. Auto save does not create Git commits.</p>
    <div className={styles.autoSave}>
      <label>Minutes<input aria-label="Auto save minutes" type="number" min="0" max="1440" step="1" required value={minutes} onChange={event => { setMinutes(event.target.value); setSaved(false) }} /></label>
      <label>Seconds<input aria-label="Auto save seconds" type="number" min="0" max="59" step="1" required value={seconds} onChange={event => { setSeconds(event.target.value); setSaved(false) }} /></label>
      <button type="submit">Apply interval</button>
    </div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {saved && <p role="status" className={styles.notice}>Interval applied.</p>}
  </form>
}
