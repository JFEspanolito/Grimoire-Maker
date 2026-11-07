import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hasUnsavedDocuments, useAppUpdateStore } from './appUpdateStore'
import { useDocumentStore } from './documentStore'
import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { invoke } from '@tauri-apps/api/core'
import { checkForAppUpdates } from '../lib/versionCheck'

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: vi.fn(() => true),
  invoke: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: vi.fn(),
}))

vi.mock('../lib/versionCheck', () => ({
  checkForAppUpdates: vi.fn(),
}))

describe('appUpdateStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useDocumentStore.setState({
      document: {
        path: '/test.md',
        body: 'Hello',
        frontmatter: { title: 'Test', pageSize: 'a4', columns: 2, theme: 'parchment' },
        dirty: false,
      },
      buffers: {},
    })
    useAppUpdateStore.setState({
      status: 'idle',
      info: null,
      isManualCheck: false,
      isPortable: false,
      currentVersion: '',
      availableVersion: null,
      releaseNotes: null,
      releaseDate: null,
      releaseUrl: null,
      errorMessage: null,
      progress: null,
      dialogOpen: false,
      confirmingUnsavedRestart: false,
      postponedVersions: [],
      updateHandle: null,
    })
  })

  it('detects update availability through native Tauri updater', async () => {
    vi.mocked(invoke).mockResolvedValue(false) // not portable
    const mockUpdate = {
      version: '0.2.0',
      currentVersion: '0.1.10',
      date: '2026-11-06T00:00:00Z',
      body: 'Release notes for 0.2.0',
      downloadAndInstall: vi.fn(),
      close: vi.fn(),
    }
    vi.mocked(check).mockResolvedValue(mockUpdate as any)

    await useAppUpdateStore.getState().checkForUpdates(true)

    const state = useAppUpdateStore.getState()
    expect(state.status).toBe('available')
    expect(state.availableVersion).toBe('0.2.0')
    expect(state.releaseNotes).toBe('Release notes for 0.2.0')
    expect(state.dialogOpen).toBe(true)
    expect(state.updateHandle).toBe(mockUpdate)
  })

  it('handles up-to-date state correctly', async () => {
    vi.mocked(invoke).mockResolvedValue(false)
    vi.mocked(check).mockResolvedValue(null)

    await useAppUpdateStore.getState().checkForUpdates(true)

    const state = useAppUpdateStore.getState()
    expect(state.status).toBe('upToDate')
    expect(state.availableVersion).toBeNull()
    expect(state.dialogOpen).toBe(true)
  })

  it('prevents concurrent update checks when already checking', async () => {
    vi.mocked(invoke).mockResolvedValue(false)
    let resolveCheck: (val: any) => void = () => {}
    vi.mocked(check).mockImplementation(() => new Promise((resolve) => { resolveCheck = resolve }))

    const firstCheck = useAppUpdateStore.getState().checkForUpdates(false)
    // Flush microtasks so detectPortableMode settles and check() is invoked
    await Promise.resolve()
    await Promise.resolve()
    expect(useAppUpdateStore.getState().status).toBe('checking')
    expect(check).toHaveBeenCalledTimes(1)

    // Second check triggered concurrently
    await useAppUpdateStore.getState().checkForUpdates(true)
    expect(check).toHaveBeenCalledTimes(1)

    resolveCheck(null)
    await firstCheck
  })

  it('postpones update and does not re-open dialog during auto-check in the same session', async () => {
    vi.mocked(invoke).mockResolvedValue(false)
    const mockUpdate = {
      version: '0.2.0',
      currentVersion: '0.1.10',
      body: 'Notes',
      downloadAndInstall: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    }
    vi.mocked(check).mockResolvedValue(mockUpdate as any)

    // First check (manual): dialog opens
    await useAppUpdateStore.getState().checkForUpdates(true)
    expect(useAppUpdateStore.getState().dialogOpen).toBe(true)

    // User postpones
    useAppUpdateStore.getState().postponeUpdate()
    expect(useAppUpdateStore.getState().dialogOpen).toBe(false)
    expect(useAppUpdateStore.getState().postponedVersions).toContain('0.2.0')
    expect(mockUpdate.close).toHaveBeenCalled()

    // Subsequent automatic check for the same version
    await useAppUpdateStore.getState().checkForUpdates(false)
    expect(useAppUpdateStore.getState().dialogOpen).toBe(false)

    // But manual check still opens the dialog
    await useAppUpdateStore.getState().checkForUpdates(true)
    expect(useAppUpdateStore.getState().dialogOpen).toBe(true)
  })

  it('handles portable mode safely without attempting native installer replacement', async () => {
    vi.mocked(invoke).mockResolvedValue(true) // is portable!
    vi.mocked(checkForAppUpdates).mockResolvedValue({
      hasUpdate: true,
      currentVersion: '0.1.10',
      latestVersion: 'v0.2.0',
      releaseUrl: 'https://github.com/JFEspanolito/Grimoire-Maker/releases/tag/v0.2.0',
    })

    await useAppUpdateStore.getState().checkForUpdates(true)

    const state = useAppUpdateStore.getState()
    expect(state.isPortable).toBe(true)
    expect(state.status).toBe('available')
    expect(state.updateHandle).toBeNull() // No unsafe native installer handle
    expect(state.releaseUrl).toContain('releases/tag/v0.2.0')
  })

  it('handles error states gracefully', async () => {
    vi.mocked(invoke).mockResolvedValue(false)
    vi.mocked(check).mockRejectedValue(new Error('Network timeout'))
    vi.mocked(checkForAppUpdates).mockResolvedValue(null)

    await useAppUpdateStore.getState().checkForUpdates(true)

    const state = useAppUpdateStore.getState()
    expect(state.status).toBe('error')
    expect(state.errorMessage).toContain('Network timeout')
    expect(state.dialogOpen).toBe(true)
  })

  it('protects unsaved documents from being lost on restart', async () => {
    // 1. Mark document dirty
    useDocumentStore.setState({
      document: {
        path: '/test.md',
        body: 'Unsaved edits',
        frontmatter: { title: 'Test', pageSize: 'a4', columns: 2, theme: 'parchment' },
        dirty: true,
      },
    })
    expect(hasUnsavedDocuments()).toBe(true)

    const mockSaveAll = vi.fn().mockResolvedValue(true)
    const restarted = await useAppUpdateStore.getState().restartApp(mockSaveAll)

    // Should NOT have restarted immediately
    expect(restarted).toBe(false)
    expect(relaunch).not.toHaveBeenCalled()
    expect(useAppUpdateStore.getState().confirmingUnsavedRestart).toBe(true)

    // 2. User confirms Save and Restart
    useDocumentStore.setState({
      document: {
        path: '/test.md',
        body: 'Unsaved edits',
        frontmatter: { title: 'Test', pageSize: 'a4', columns: 2, theme: 'parchment' },
        dirty: false, // After save, it becomes clean
      },
    })

    const saveAndRestartResult = await useAppUpdateStore.getState().confirmSaveAndRestart(mockSaveAll)
    expect(saveAndRestartResult).toBe(true)
    expect(mockSaveAll).toHaveBeenCalled()
    expect(relaunch).toHaveBeenCalled()
  })

  it('aborts restart if saving fails when unsaved documents are present', async () => {
    useDocumentStore.setState({
      document: {
        path: '/test.md',
        body: 'Unsaved edits',
        frontmatter: { title: 'Test', pageSize: 'a4', columns: 2, theme: 'parchment' },
        dirty: true,
      },
    })

    const failingSaveAll = vi.fn().mockResolvedValue(false)
    const result = await useAppUpdateStore.getState().confirmSaveAndRestart(failingSaveAll)

    expect(result).toBe(false)
    expect(relaunch).not.toHaveBeenCalled()
    expect(useAppUpdateStore.getState().status).toBe('error')
    expect(useAppUpdateStore.getState().errorMessage).toContain('Could not save unsaved documents')
  })
})
