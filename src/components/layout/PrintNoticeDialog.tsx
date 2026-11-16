import { useEffect, useRef, useState } from 'react'
import { PRINT_NOTICE_EVENT, type PrintNotice } from '../../hooks/usePrint'
import { useTranslation } from '../../lib/i18n'
import { ConfirmDialog } from './ConfirmDialog'

/** Hosts print notices outside browser alert(), including on Tauri webviews. */
export function PrintNoticeDialog() {
  const { t } = useTranslation()
  const [notice, setNotice] = useState<PrintNotice | null>(null)
  const pending = useRef<PrintNotice | null>(null)
  useEffect(() => {
    const receive = (event: Event) => {
      event.preventDefault()
      const next = (event as CustomEvent<PrintNotice>).detail
      pending.current?.resolve(false)
      pending.current = next
      setNotice(next)
    }
    window.addEventListener(PRINT_NOTICE_EVENT, receive)
    return () => {
      window.removeEventListener(PRINT_NOTICE_EVENT, receive)
      pending.current?.resolve(false)
      pending.current = null
    }
  }, [])
  if (!notice) return null
  const close = (accepted: boolean) => {
    pending.current = null
    setNotice(null)
    notice.resolve(accepted)
  }
  return <ConfirmDialog title={t(notice.confirm ? 'print.title' : 'print.failed')}
    hideCancel={!notice.confirm}
    message={notice.message} cancelLabel={t(notice.confirm ? 'common.cancel' : 'common.close')}
    confirmLabel={t(notice.confirm ? 'print.continue' : 'common.close')}
    onCancel={() => close(false)} onConfirm={() => close(notice.confirm)} />
}
