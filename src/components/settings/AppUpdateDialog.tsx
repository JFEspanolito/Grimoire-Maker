import { useEffect, useRef } from 'react'
import { useAppUpdateStore } from '../../stores/appUpdateStore'
import { useTranslation } from '../../lib/i18n'
import { useFileSystem } from '../../hooks/useFileSystem'
import { openExternalUrl } from '../../lib/openUrl'
import styles from './AppUpdateDialog.module.css'

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

export function AppUpdateDialog() {
  const { t } = useTranslation()
  const { saveAll } = useFileSystem()
  const dialogRef = useRef<HTMLDialogElement>(null)

  const {
    dialogOpen,
    status,
    isPortable,
    currentVersion,
    availableVersion,
    releaseNotes,
    releaseUrl,
    errorMessage,
    progress,
    confirmingUnsavedRestart,
    startDownloadAndInstall,
    restartApp,
    confirmSaveAndRestart,
    cancelUnsavedRestart,
    postponeUpdate,
    closeDialog,
    checkForUpdates,
  } = useAppUpdateStore()

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (dialogOpen) {
      if (!dialog.open) {
        dialog.showModal()
      }
    } else {
      if (dialog.open) {
        dialog.close()
      }
    }
  }, [dialogOpen])

  if (!dialogOpen) return null

  const handleOpenRelease = () => {
    if (releaseUrl) {
      void openExternalUrl(releaseUrl)
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="update-dialog-title"
      onCancel={(e) => {
        e.preventDefault()
        if (status === 'downloading') return // Prevent closing while downloading
        postponeUpdate()
      }}
    >
      <header className={styles.header}>
        <h2 id="update-dialog-title">
          {confirmingUnsavedRestart
            ? t('updater.unsavedTitle')
            : status === 'upToDate'
              ? t('updater.upToDateTitle')
              : status === 'error'
                ? t('updater.errorTitle')
                : t('updater.title')}
        </h2>
        {status !== 'downloading' && (
          <button
            type="button"
            className={styles.dismiss}
            aria-label={t('common.close')}
            onClick={() => {
              if (confirmingUnsavedRestart) cancelUnsavedRestart()
              else postponeUpdate()
            }}
          >
            ×
          </button>
        )}
      </header>

      <div className={styles.body}>
        {confirmingUnsavedRestart ? (
          <div>
            <div className={styles.warningBox}>
              <p>{t('updater.unsavedMessage')}</p>
            </div>
            <p className={styles.notice}>
              Any unsaved changes will be saved before restarting Grimoire Maker.
            </p>
          </div>
        ) : status === 'checking' ? (
          <p className={styles.notice}>{t('about.checkingUpdates')}</p>
        ) : status === 'upToDate' ? (
          <div>
            <p className={styles.notice}>{t('updater.upToDateMessage')}</p>
            {currentVersion && (
              <dl className={styles.versionGrid}>
                <dt>{t('updater.currentVersion')}</dt>
                <dd>{currentVersion}</dd>
              </dl>
            )}
          </div>
        ) : status === 'error' ? (
          <div>
            <div className={styles.errorBox}>
              <p>{errorMessage || t('updater.errorMessage')}</p>
            </div>
            {currentVersion && (
              <dl className={styles.versionGrid}>
                <dt>{t('updater.currentVersion')}</dt>
                <dd>{currentVersion}</dd>
              </dl>
            )}
          </div>
        ) : isPortable ? (
          <div>
            <div className={styles.warningBox}>
              <p>{t('updater.portableNotice')}</p>
            </div>
            <dl className={styles.versionGrid}>
              <dt>{t('updater.currentVersion')}</dt>
              <dd>{currentVersion || '—'}</dd>
              <dt>{t('updater.availableVersion')}</dt>
              <dd>{availableVersion || '—'}</dd>
            </dl>
            {releaseNotes && (
              <div className={styles.releaseNotes}>
                <h4>{t('updater.releaseNotes')}</h4>
                <div className={styles.notesContent}>{releaseNotes}</div>
              </div>
            )}
          </div>
        ) : status === 'downloading' ? (
          <div>
            <p className={styles.notice}>
              {progress?.percent === 100
                ? t('updater.installing')
                : t('updater.downloading')}
            </p>
            <div className={styles.progressContainer}>
              <div className={styles.progressLabel}>
                <span>
                  {progress?.totalBytes
                    ? `${formatBytes(progress.downloadedBytes)} / ${formatBytes(progress.totalBytes)}`
                    : formatBytes(progress?.downloadedBytes ?? 0)}
                </span>
                <span>{progress?.percent !== null ? `${progress?.percent}%` : ''}</span>
              </div>
              <div className={styles.progressBar}>
                {progress?.percent !== null ? (
                  <div
                    className={styles.progressBarFill}
                    style={{ width: `${progress?.percent ?? 0}%` }}
                  />
                ) : (
                  <div className={styles.progressBarIndeterminate} />
                )}
              </div>
            </div>
          </div>
        ) : status === 'readyToRestart' ? (
          <div>
            <p className={styles.notice}>{t('updater.readyToRestart')}</p>
            <dl className={styles.versionGrid}>
              <dt>{t('updater.currentVersion')}</dt>
              <dd>{currentVersion || '—'}</dd>
              <dt>{t('updater.availableVersion')}</dt>
              <dd>{availableVersion || '—'}</dd>
            </dl>
          </div>
        ) : (
          <div>
            <p className={styles.notice}>{t('updater.newVersionAvailable')}</p>
            <dl className={styles.versionGrid}>
              <dt>{t('updater.currentVersion')}</dt>
              <dd>{currentVersion || '—'}</dd>
              <dt>{t('updater.availableVersion')}</dt>
              <dd>{availableVersion || '—'}</dd>
            </dl>
            {releaseNotes && (
              <div className={styles.releaseNotes}>
                <h4>{t('updater.releaseNotes')}</h4>
                <div className={styles.notesContent}>{releaseNotes}</div>
              </div>
            )}
          </div>
        )}
      </div>

      <footer className={styles.footer}>
        {confirmingUnsavedRestart ? (
          <>
            <button type="button" onClick={cancelUnsavedRestart}>
              {t('updater.cancelRestart')}
            </button>
            <button
              type="button"
              className={styles.primary}
              onClick={() => void confirmSaveAndRestart(saveAll)}
            >
              {t('updater.saveAndRestart')}
            </button>
          </>
        ) : status === 'upToDate' ? (
          <button type="button" className={styles.primary} onClick={closeDialog}>
            {t('common.close')}
          </button>
        ) : status === 'error' ? (
          <>
            <button type="button" onClick={closeDialog}>
              {t('common.close')}
            </button>
            <button
              type="button"
              className={styles.primary}
              onClick={() => void checkForUpdates(true)}
            >
              Retry
            </button>
          </>
        ) : isPortable ? (
          <>
            <button type="button" onClick={postponeUpdate}>
              {t('updater.later')}
            </button>
            <button
              type="button"
              className={styles.primary}
              onClick={handleOpenRelease}
            >
              {t('updater.openReleases')}
            </button>
          </>
        ) : status === 'downloading' ? (
          <button type="button" disabled>
            {t('common.working')}
          </button>
        ) : status === 'readyToRestart' ? (
          <>
            <button type="button" onClick={postponeUpdate}>
              {t('updater.later')}
            </button>
            <button
              type="button"
              className={styles.primary}
              onClick={() => void restartApp(saveAll)}
            >
              {t('updater.restartNow')}
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={postponeUpdate}>
              {t('updater.later')}
            </button>
            <button
              type="button"
              className={styles.primary}
              onClick={() => void startDownloadAndInstall()}
            >
              {t('updater.downloadAndInstall')}
            </button>
          </>
        )}
      </footer>
    </dialog>
  )
}
