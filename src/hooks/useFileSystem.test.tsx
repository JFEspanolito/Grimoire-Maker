import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { open, save } from '@tauri-apps/plugin-dialog'
import { exists, mkdir, readDir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'
import { loadAppState, updateAppState, type AppState } from '../lib/appState'
import { useDocumentStore } from '../stores/documentStore'
import { useSessionStore } from '../stores/sessionStore'
import { useTabStore } from '../stores/tabStore'
import { useFileSystem } from './useFileSystem'

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn(),
  mkdir: vi.fn(),
  readDir: vi.fn(),
  readTextFile: vi.fn(),
  rename: vi.fn(),
  writeTextFile: vi.fn(),
}))
vi.mock('../lib/appState', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/appState')>()),
  loadAppState: vi.fn(),
  updateAppState: vi.fn(),
}))

const emptyState = (): AppState => ({ lastWorkspace: null, recentWorkspaces: [], lastFile: null, settings: {} })
let state: AppState
let actions: ReturnType<typeof useFileSystem>
let directories: Set<string>
let root: Root | null = null

function Harness({ onReady }: { onReady: (value: ReturnType<typeof useFileSystem>) => void }) {
  const value = useFileSystem()
  useEffect(() => onReady(value), [onReady, value])
  return null
}

beforeEach(async () => {
  Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true })
  state = emptyState()
  directories = new Set(['/workspace'])
  useDocumentStore.getState().loadFromRaw(null, '')
  useTabStore.getState().reset(null)
  useDocumentStore.getState().setWorkspace(null, [])
  useSessionStore.getState().setRecentWorkspaces([])
  vi.mocked(open).mockResolvedValue('/workspace')
  vi.mocked(save).mockResolvedValue('/workspace/Draft/untitled.md')
  vi.mocked(invoke).mockResolvedValue(undefined)
  vi.mocked(readTextFile).mockResolvedValue('# Next chapter')
  vi.mocked(writeTextFile).mockResolvedValue(undefined)
  vi.mocked(loadAppState).mockImplementation(async () => state)
  vi.mocked(updateAppState).mockImplementation(async (change) => (state = change(state)))
  vi.mocked(exists).mockImplementation(async (path) => directories.has(String(path)))
  vi.mocked(mkdir).mockImplementation(async (path) => { directories.add(String(path)) })
  vi.mocked(readDir).mockImplementation(async (path) =>
    String(path) === '/workspace'
      ? ['Draft', 'Research', 'Trash'].filter((name) => directories.has(`/workspace/${name}`))
          .map((name) => ({ name, isDirectory: true, isFile: false, isSymlink: false }))
      : [],
  )
  root = createRoot(document.createElement('div'))
  await act(async () => root?.render(<Harness onReady={(value) => { actions = value }} />))
})

describe('switching Markdown files', () => {
  it('opens a second file in a separate tab and returns to the first', async () => {
    useDocumentStore.getState().loadFromRaw('/workspace/Draft/one.md', '# First')
    useTabStore.getState().reset('/workspace/Draft/one.md')

    await actions.openFile('/workspace/Draft/two.md', true)
    expect(useTabStore.getState().paths).toEqual(['/workspace/Draft/one.md', '/workspace/Draft/two.md'])

    await actions.openFile('/workspace/Draft/one.md')
    expect(useTabStore.getState().active).toBe('/workspace/Draft/one.md')
    expect(useTabStore.getState().paths).toHaveLength(2)
  })

  it('saves an edited tab before closing it and returns to the remaining tab', async () => {
    useDocumentStore.getState().loadFromRaw('/workspace/Draft/one.md', '# First')
    useTabStore.getState().reset('/workspace/Draft/one.md')
    await actions.openFile('/workspace/Draft/two.md', true)
    useDocumentStore.getState().setBody('# Edited second')

    await actions.closeTab('/workspace/Draft/two.md')

    expect(writeTextFile).toHaveBeenCalledWith('/workspace/Draft/two.md', '# Edited second')
    expect(useTabStore.getState().paths).toEqual(['/workspace/Draft/one.md'])
    expect(useDocumentStore.getState().document.path).toBe('/workspace/Draft/one.md')
  })
  it('saves changes to the current file before replacing the editor content', async () => {
    useDocumentStore.getState().loadFromRaw('/workspace/Draft/one.md', '# Original')
    useDocumentStore.getState().setBody('# Edited')

    await actions.openFile('/workspace/Draft/two.md')

    expect(writeTextFile).toHaveBeenCalledWith('/workspace/Draft/one.md', '# Edited')
    expect(useDocumentStore.getState().document.path).toBe('/workspace/Draft/two.md')
    expect(useDocumentStore.getState().document.body).toBe('# Next chapter')
  })

  it('keeps dirty content visible when saving the old file fails', async () => {
    useDocumentStore.getState().loadFromRaw('/workspace/Draft/one.md', '# Original')
    useDocumentStore.getState().setBody('# Edited')
    vi.mocked(writeTextFile).mockRejectedValueOnce(new Error('Disk full'))

    await expect(actions.openFile('/workspace/Draft/two.md')).rejects.toThrow('Disk full')

    expect(useDocumentStore.getState().document.path).toBe('/workspace/Draft/one.md')
    expect(useDocumentStore.getState().document.body).toBe('# Edited')
    expect(useDocumentStore.getState().document.dirty).toBe(true)
  })

  it('does not replace an unsaved document if Save As is cancelled', async () => {
    useDocumentStore.getState().loadFromRaw(null, '# Original')
    useDocumentStore.getState().setBody('# Edited')
    vi.mocked(save).mockResolvedValueOnce(null)

    await actions.openFile('/workspace/Draft/two.md')

    expect(useDocumentStore.getState().document.path).toBeNull()
    expect(useDocumentStore.getState().document.body).toBe('# Edited')
    expect(useDocumentStore.getState().document.dirty).toBe(true)
  })
})

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  delete (window as Window & { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__
  vi.clearAllMocks()
})

describe('workspace opening', () => {
  it('creates binder sections when opening an empty project and remembers it', async () => {
    await actions.openWorkspace()

    expect(useDocumentStore.getState().tree.map((node) => node.name)).toEqual(['Draft', 'Research', 'Trash'])
    expect(state.lastWorkspace).toBe('/workspace')
    expect(save).not.toHaveBeenCalled()
  })

  it('opens an existing Draft document instead of leaving the welcome page visible', async () => {
    directories.add('/workspace/Draft')
    vi.mocked(readDir).mockImplementation(async (path) =>
      String(path) === '/workspace'
        ? [{ name: 'Draft', isDirectory: true, isFile: false, isSymlink: false }]
        : String(path) === '/workspace/Draft'
          ? [{ name: 'chapter.md', isDirectory: false, isFile: true, isSymlink: false }]
          : [],
    )

    await actions.openWorkspace()

    expect(useDocumentStore.getState().document.path).toBe('/workspace/Draft/chapter.md')
    expect(useDocumentStore.getState().document.body).toBe('# Next chapter')
    expect(save).not.toHaveBeenCalled()
  })

  it('opens a Markdown file in Trash without asking to save a clean document', async () => {
    await actions.openWorkspace()

    await actions.openFile('/workspace/Trash/deleted.md')

    expect(useDocumentStore.getState().document.path).toBe('/workspace/Trash/deleted.md')
    expect(save).not.toHaveBeenCalled()
  })

  it('restores the last project and its binder sections on startup', async () => {
    state = { ...emptyState(), lastWorkspace: '/workspace', recentWorkspaces: ['/workspace'] }

    await actions.restoreSession()

    expect(invoke).toHaveBeenCalledWith('restore_workspace', { path: '/workspace' })
    expect(useDocumentStore.getState().workspaceRoot).toBe('/workspace')
    expect(useDocumentStore.getState().tree.map((node) => node.name)).toEqual(['Draft', 'Research', 'Trash'])
  })

  it('restores the remembered Markdown file instead of another Draft file', async () => {
    state = { ...emptyState(), lastWorkspace: '/workspace', recentWorkspaces: ['/workspace'],
      lastFile: '/workspace/Draft/second.md' }
    directories.add('/workspace/Draft/second.md')
    vi.mocked(readDir).mockImplementation(async (path) => String(path) === '/workspace'
      ? [{ name: 'Draft', isDirectory: true, isFile: false, isSymlink: false }]
      : String(path) === '/workspace/Draft'
        ? [
          { name: 'first.md', isDirectory: false, isFile: true, isSymlink: false },
          { name: 'second.md', isDirectory: false, isFile: true, isSymlink: false },
        ] : [])

    await actions.restoreSession()

    expect(useDocumentStore.getState().document.path).toBe('/workspace/Draft/second.md')
  })

  it('runs concurrent startup restore requests only once', async () => {
    state = { ...emptyState(), lastWorkspace: '/workspace', recentWorkspaces: ['/workspace'] }

    await Promise.all([actions.restoreSession(), actions.restoreSession()])

    expect(invoke).toHaveBeenCalledTimes(1)
    expect(mkdir).toHaveBeenCalledTimes(3)
  })

  it('keeps a remembered project when restoration fails instead of forgetting it silently', async () => {
    state = { ...emptyState(), lastWorkspace: '/workspace', recentWorkspaces: ['/workspace'] }
    vi.mocked(invoke).mockRejectedValueOnce(new Error('Cannot restore access'))

    await actions.restoreSession()

    expect(state.lastWorkspace).toBe('/workspace')
    expect(state.recentWorkspaces).toContain('/workspace')
    expect(useSessionStore.getState().workspaceError).toContain('Cannot restore access')
  })
})

describe('project rename', () => {
  it('renames the folder without opening Save As for an unsaved editor', async () => {
    useDocumentStore.getState().setWorkspace('/workspace', [])
    useDocumentStore.getState().setBody('# Unsaved notes')
    vi.mocked(invoke).mockResolvedValueOnce('/Renamed')
    vi.mocked(readDir).mockResolvedValue([])

    await actions.renameWorkspace('Renamed')

    expect(save).not.toHaveBeenCalled()
    expect(useDocumentStore.getState().document.body).toBe('# Unsaved notes')
    expect(useDocumentStore.getState().document.dirty).toBe(true)
  })
  it('keeps the project folder, open document, and remembered paths together', async () => {
    state = {
      ...emptyState(), lastWorkspace: '/workspace', recentWorkspaces: ['/workspace'],
      lastFile: '/workspace/Draft/chapter.md',
    }
    useDocumentStore.getState().setWorkspace('/workspace', [])
    useDocumentStore.getState().loadFromRaw('/workspace/Draft/chapter.md', '# Chapter')
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === 'rename_workspace') {
        state = {
          ...state, lastWorkspace: '/My Grimoire', recentWorkspaces: ['/My Grimoire'],
          lastFile: '/My Grimoire/Draft/chapter.md',
        }
        return '/My Grimoire'
      }
      return undefined
    })
    vi.mocked(readDir).mockResolvedValue([])

    await actions.renameWorkspace('My Grimoire')

    expect(invoke).toHaveBeenCalledWith('rename_workspace', { path: '/workspace', name: 'My Grimoire' })
    expect(useDocumentStore.getState().workspaceRoot).toBe('/My Grimoire')
    expect(useDocumentStore.getState().document.path).toBe('/My Grimoire/Draft/chapter.md')
    expect(useSessionStore.getState().recentWorkspaces).toEqual(['/My Grimoire'])
  })

  it('leaves the active project untouched when the native rename is rejected', async () => {
    useDocumentStore.getState().setWorkspace('/workspace', [])
    useDocumentStore.getState().loadFromRaw('/workspace/Draft/chapter.md', '# Chapter')
    vi.mocked(invoke).mockRejectedValueOnce(new Error('Destination already exists'))

    await expect(actions.renameWorkspace('Existing')).rejects.toThrow('Destination already exists')
    expect(useDocumentStore.getState().workspaceRoot).toBe('/workspace')
    expect(useDocumentStore.getState().document.path).toBe('/workspace/Draft/chapter.md')
  })
})
