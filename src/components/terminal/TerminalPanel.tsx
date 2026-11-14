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

export function TerminalPanel({ workspace }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(240)
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const togglePanel = useSettingsStore((s) => s.togglePanel)

  useEffect(() => {
    if (!containerRef.current) return

    let isMounted = true
    let unlistenOutput: UnlistenFn | undefined
    let unlistenExit: UnlistenFn | undefined

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
          unlistenOutput = await listen<string>('terminal-output', (event) => {
            if (isMounted) term.write(event.payload)
          })
          unlistenExit = await listen('terminal-exit', () => {
            if (isMounted) term.write('\r\n\x1b[33m[Process exited]\x1b[0m\r\n')
          })

          term.onData((data) => {
            void invoke('write_terminal', { data }).catch(() => {})
          })

          term.onResize(({ rows, cols }) => {
            void invoke('resize_terminal', { rows, cols }).catch(() => {})
          })

          await invoke('spawn_terminal', {
            options: {
              cwd: workspace || undefined,
              rows: term.rows || 24,
              cols: term.cols || 80,
            },
          })
        } catch (error) {
          if (isMounted) {
            term.writeln(`\x1b[31mFailed to start terminal session: ${String(error)}\x1b[0m`)
          }
        }
      })()
    } else {
      term.writeln('\x1b[33m[Grimoire Maker Terminal - Web Preview]\x1b[0m')
      term.writeln('PTY process execution is active in the Tauri desktop application.')
      term.writeln('Run `agy` directly inside the desktop terminal.\r\n')
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
      try {
        fitAddon.fit()
      } catch {}
    }
    window.addEventListener('resize', onResizeWindow)

    return () => {
      isMounted = false
      window.removeEventListener('resize', onResizeWindow)
      if (unlistenOutput) unlistenOutput()
      if (unlistenExit) unlistenExit()
      term.dispose()
      terminalRef.current = null
      if (isTauri()) {
        void invoke('close_terminal').catch(() => {})
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
      aria-label="Terminal"
      className={styles.panel}
      style={{ height }}
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize terminal panel"
        className={styles.handle}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
      <header className={styles.header}>
        <div className={styles.title}>
          <span>Terminal</span>
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.actionButton}
            aria-label="Clear terminal"
            title="Clear terminal"
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
            aria-label="Close terminal panel"
            title="Close terminal"
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
