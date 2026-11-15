import { getTranslation, useTranslation } from '../../lib/i18n'
import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useSettingsStore } from '../../stores/settingsStore'
import styles from './TerminalPanel.module.css'

interface Props {
  workspace?: string | null
}

interface TerminalOutput { sessionId: string; data: string }
interface TerminalExit { sessionId: string }
// React effects can overlap while native IPC settles. Keep close/start ordered across mounts.
let lifecycle: Promise<void> = Promise.resolve()
function scheduleLifecycle(action: () => Promise<void>): Promise<void> {
  const next = lifecycle.then(action)
  lifecycle = next.catch(() => undefined)
  return next
}

export function TerminalPanel({ workspace }: Props) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(240)
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const togglePanel = useSettingsStore((s) => s.togglePanel)

  useEffect(() => {
    const translate = (key: Parameters<typeof getTranslation>[0]) => getTranslation(key, useSettingsStore.getState().language)
    if (!containerRef.current) return

    let isMounted = true
    let unlistenOutput: UnlistenFn | undefined
    let unlistenExit: UnlistenFn | undefined
    let sessionId: string | null = null
    const pendingResize: { size?: { rows: number; cols: number } } = {}
    const earlyEvents: Array<TerminalOutput | TerminalExit> = []
    const receive = (payload: TerminalOutput | TerminalExit) => {
      if (!isMounted) return
      if (!sessionId) { earlyEvents.push(payload); return }
      if (payload.sessionId !== sessionId) return
      if ('data' in payload) term.write(payload.data)
      else term.write(`\r\n\x1b[33m${translate('ui.process_exited')}\x1b[0m\r\n`)
    }

    const term = new Terminal({
      theme: {
        background: '#181818',
        foreground: '#cccccc',
        cursor: '#cfb37c',
        selectionBackground: '#59564e66',
      },
      fontFamily: 'Consolas, "Cascadia Code", "Fira Code", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'block',
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)
    terminalRef.current = term

    try {
      fitAddon.fit()
    } catch {
      // In non-rendered environments (like JSDOM) fit may throw gracefully
    }

    if (isTauri()) {
      void (async () => {
        try {
          unlistenOutput = await listen<TerminalOutput>('terminal-output', (event) => receive(event.payload))
          if (!isMounted) { unlistenOutput(); return }
          unlistenExit = await listen<TerminalExit>('terminal-exit', (event) => receive(event.payload))
          if (!isMounted) { unlistenExit(); return }

          term.onData((data) => {
            if (isMounted && sessionId) void invoke('write_terminal', { sessionId, data }).catch(() => {})
          })

          term.onResize(({ rows, cols }) => {
            pendingResize.size = { rows, cols }
            if (isMounted && sessionId) void invoke('resize_terminal', { sessionId, rows, cols }).catch(() => {})
          })

          await scheduleLifecycle(async () => {
            if (!isMounted) return
            sessionId = await invoke<string>('spawn_terminal', {
              options: { cwd: workspace || undefined, rows: term.rows || 24, cols: term.cols || 80 },
            })
            if (!isMounted) {
              await invoke('close_terminal', { sessionId })
              sessionId = null
              return
            }
            if (pendingResize.size) {
              void invoke('resize_terminal', { sessionId, ...pendingResize.size }).catch(() => {})
              pendingResize.size = undefined
            }
            earlyEvents.splice(0).forEach(receive)
          })
        } catch (error) {
          if (isMounted) {
            term.writeln(`\x1b[31m${getTranslation('ui.terminalFailed', useSettingsStore.getState().language, { error: String(error) })}\x1b[0m`)
          }
        }
      })()
    } else {
      term.writeln(`\x1b[33m${translate('ui.grimoire_maker_terminal_web_preview')}\x1b[0m`)
      term.writeln(translate('ui.pty_process_execution_is_active_in_the_tauri_desktop_application'))
      term.writeln(`${translate('ui.run_agy_directly_inside_the_desktop_terminal')}\r\n`)
      term.onData((data) => {
        if (data === '\r') {
          term.write('\r\n$ ')
        } else if (data === '\u007F') {
          term.write('\b \b')
        } else {
          term.write(data)
        }
      })
      term.write('$ ')
    }

    const onResizeWindow = () => {
      if (!isMounted) return
      try {
        fitAddon.fit()
      } catch {}
    }
    window.addEventListener('resize', onResizeWindow)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onResizeWindow)
    observer?.observe(containerRef.current)

    return () => {
      isMounted = false
      window.removeEventListener('resize', onResizeWindow)
      observer?.disconnect()
      if (unlistenOutput) unlistenOutput()
      if (unlistenExit) unlistenExit()
      term.dispose()
      earlyEvents.length = 0
      if (terminalRef.current === term) terminalRef.current = null
      if (isTauri()) {
        void scheduleLifecycle(async () => {
          if (sessionId) {
            await invoke('close_terminal', { sessionId })
            sessionId = null
          }
        }).catch(() => {})
      }
    }
  }, [workspace])

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    dragRef.current = { startY: e.clientY, startHeight: height }
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    const deltaY = dragRef.current.startY - e.clientY
    const newHeight = Math.max(120, Math.min(600, dragRef.current.startHeight + deltaY))
    setHeight(newHeight)
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    dragRef.current = null
    e.currentTarget.releasePointerCapture?.(e.pointerId)
  }

  const clearTerminal = () => {
    terminalRef.current?.clear()
  }

  return (
    <section
      id="terminal-panel"
      aria-label={t('ui.terminal')}
      className={styles.panel}
      style={{ height }}
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label={t('ui.resize_terminal_panel')}
        className={styles.handle}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
      <header className={styles.header}>
        <div className={styles.title}>
          <span>{t('ui.terminal')}</span>
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.actionButton}
            aria-label={t('ui.clear_terminal')}
            title={t('ui.clear_terminal')}
            onClick={clearTerminal}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z" />
              <path fillRule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z" />
            </svg>
          </button>
          <button
            type="button"
            className={styles.actionButton}
            aria-label={t('ui.close_terminal_panel')}
            title={t('ui.close_terminal')}
            onClick={() => togglePanel('bottomPanel')}
          >
            ✕
          </button>
        </div>
      </header>
      <div ref={containerRef} className={styles.terminalContainer} />
    </section>
  )
}
