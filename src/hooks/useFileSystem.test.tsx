import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { open, save } from '@tauri-apps/plugin-dialog'
import { exists, mkdir, readDir, readTextFile, writeTextFile, readFile, writeFile, stat, rename } from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'
import { loadAppState, updateAppState, type AppState } from '../lib/appState'
import { applyTemplateFiles } from '../lib/templateActions'
import { useDocumentStore } from '../stores/documentStore'
import { useSessionStore } from '../stores/sessionStore'
import { useTabStore } from '../stores/tabStore'
import { useExplorerStore } from '../stores/explorerStore'
import { useFileSystem } from './useFileSystem'
import { loadSettings } from '../lib/preferences'
import { useSettingsStore } from '../stores/settingsStore'

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn(),
  mkdir: vi.fn(),
  readDir: vi.fn(),
  readTextFile: vi.fn(),
  rename: vi.fn(),
  writeTextFile: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  stat: vi.fn(),
}))
vi.mock('../lib/appState', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/appState')>()),
  loadAppState: vi.fn(),
  updateAppState: vi.fn(),
}))
vi.mock('../lib/templateActions', () => ({ applyTemplateFiles: vi.fn() }))
vi.mock('../lib/preferences', () => ({ loadSettings: vi.fn(), saveSettings: vi.fn().mockResolvedValue(undefined) }))

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
  vi.mocked(loadSettings).mockResolvedValue({})
  directories = new Set(['/workspace'])
  useDocumentStore.getState().resetDocuments()
  useDocumentStore.getState().loadFromRaw(null, '')
  useTabStore.getState().reset(null)
  useExplorerStore.getState().selectPath(null)
  useDocumentStore.getState().setWorkspace(null, [])
  useSessionStore.getState().setRecentWorkspaces([])
  vi.mocked(open).mockResolvedValue('/workspace')
  vi.mocked(save).mockResolvedValue('/workspace/Draft/untitled.md')
  vi.mocked(invoke).mockResolvedValue(undefined)
  vi.mocked(readTextFile).mockResolvedValue('# Next chapter')
  vi.mocked(writeTextFile).mockResolvedValue(undefined)
  vi.mocked(loadAppState).mockImplementation(async () => state)
  vi.mocked(applyTemplateFiles).mockResolvedValue('/workspace/Draft/pack/index.md')
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

describe('new files and projects', () => {
  it('creates a separate named project with the demo and remembers it', async () => {
    expect(await actions.createProject('My Grimoire')).toBe(true)
    expect(open).toHaveBeenCalledWith({ directory: true, recursive: true, title: 'Choose a location for My Grimoire' })
    expect(mkdir).toHaveBeenCalledWith('/workspace/My Grimoire')
    expect(writeTextFile).toHaveBeenCalledWith('/workspace/My Grimoire/Draft/Chapter 1/Welcome.md', expect.stringContaining('# Welcome to Grimoire Maker'), { createNew: true })
    expect(useDocumentStore.getState().workspaceRoot).toBe('/workspace/My Grimoire')
    expect(state.lastWorkspace).toBe('/workspace/My Grimoire')
    expect(useTabStore.getState().active).toBe('/workspace/My Grimoire/Draft/Chapter 1/Welcome.md')
  })

  it('cancels project creation without creating folders', async () => {
    vi.mocked(open).mockResolvedValueOnce(null)
    expect(await actions.createProject('Cancelled')).toBe(false)
    expect(mkdir).not.toHaveBeenCalled()
    expect(writeTextFile).not.toHaveBeenCalled()
  })

  it('rejects an existing project folder without changing the workspace', async () => {
    directories.add('/workspace/Existing')
    await expect(actions.createProject('Existing')).rejects.toThrow('already exists')
    expect(mkdir).not.toHaveBeenCalled()
    expect(useDocumentStore.getState().workspaceRoot).toBeNull()
  })

  it('keeps unsaved text and creates nothing when saving before a new project is cancelled', async () => {
    useDocumentStore.getState().setBody('Keep these notes')
    vi.mocked(save).mockResolvedValueOnce(null)
    expect(await actions.createProject('Cancelled')).toBe(false)
    expect(mkdir).not.toHaveBeenCalled()
    expect(useDocumentStore.getState().document.body).toBe('Keep these notes')
  })

  it('creates a Markdown file in a new tab while preserving the dirty current file', async () => {
    useDocumentStore.getState().setWorkspace('/workspace', [])
    useDocumentStore.getState().loadFromRaw('/workspace/Draft/old.md', 'Old')
    useDocumentStore.getState().setBody('Unsaved')
    useTabStore.getState().reset('/workspace/Draft/old.md')
    vi.mocked(readTextFile).mockResolvedValueOnce('')
    await actions.createNewFile()
    expect(save).toHaveBeenCalledWith({ title: 'New Markdown File', defaultPath: '/workspace/Draft/untitled.md', filters: [{ name: 'Markdown', extensions: ['md'] }] })
    expect(writeTextFile).toHaveBeenCalledWith('/workspace/Draft/untitled.md', '', { createNew: true })
    expect(useTabStore.getState().paths).toEqual(['/workspace/Draft/old.md', '/workspace/Draft/untitled.md'])
    expect(useDocumentStore.getState().buffers['/workspace/Draft/old.md']).toMatchObject({ body: 'Unsaved', dirty: true })
    expect(useDocumentStore.getState().document.body).toBe('')
  })

  it('does not overwrite an existing file through New File', async () => {
    directories.add('/workspace/Draft/untitled.md')
    await expect(actions.createNewFile()).rejects.toThrow('already exists')
    expect(writeTextFile).not.toHaveBeenCalled()
  })

  it('does nothing when New File is cancelled', async () => {
    vi.mocked(save).mockResolvedValueOnce(null)
    await actions.createNewFile()
    expect(writeTextFile).not.toHaveBeenCalled()
    expect(useTabStore.getState().paths).toEqual([])
  })
})

describe('switching Markdown files', () => {
  it('restores a remembered PDF without reading it as Markdown', async () => {
    state = { ...emptyState(), lastWorkspace: '/workspace', lastFile: '/workspace/Research/ref.pdf' }
    directories.add('/workspace/Research/ref.pdf')
    await actions.openRecent('/workspace')
    expect(useTabStore.getState().active).toBe('/workspace/Research/ref.pdf')
    expect(useDocumentStore.getState().document.path).toBeNull()
    expect(readTextFile).not.toHaveBeenCalled()
  })
  it('keeps the active preview remembered when saving background Markdown buffers', async () => {
    useDocumentStore.getState().loadFromRaw('/a.md', 'A')
    useTabStore.getState().reset('/a.md')
    useDocumentStore.getState().setBody('unsaved')
    await actions.openFile('/reference.pdf')
    await actions.saveAll()
    expect(writeTextFile).toHaveBeenCalledWith('/a.md', 'unsaved')
    expect(useTabStore.getState().active).toBe('/reference.pdf')
    expect(state.lastFile).toBe('/reference.pdf')
    expect(useDocumentStore.getState().buffers['/a.md'].dirty).toBe(false)
  })
  it('replaces a clean tab on ordinary open and discards its cached buffer', async () => {
    useDocumentStore.getState().loadFromRaw('/a.md', 'A')
    useTabStore.getState().reset('/a.md')
    await actions.openFile('/b.md')
    expect(useTabStore.getState().paths).toEqual(['/b.md'])
    expect(useDocumentStore.getState().buffers['/a.md']).toBeUndefined()
  })
  it('retains edits made while the next file is loading', async () => {
    useDocumentStore.getState().loadFromRaw('/a.md', 'A')
    useTabStore.getState().reset('/a.md')
    vi.mocked(readTextFile).mockImplementationOnce(async () => {
      useDocumentStore.getState().setBody('typed while loading')
      return 'B'
    })
    await actions.openFile('/b.md')
    expect(useTabStore.getState().paths).toEqual(['/a.md', '/b.md'])
    expect(useDocumentStore.getState().buffers['/a.md'].body).toBe('typed while loading')
    expect(writeTextFile).not.toHaveBeenCalled()
  })
  it.each(['/photo.png', '/reference.pdf', '/notes.docx'])('opens %s read-only without parsing or saving binary bytes', async (path) => {
    useDocumentStore.getState().loadFromRaw('/a.md', 'A')
    useTabStore.getState().reset('/a.md')
    useDocumentStore.getState().setBody('unsaved A')
    await actions.openFile(path)
    expect(useTabStore.getState().paths).toEqual(['/a.md', path])
    expect(useTabStore.getState().active).toBe(path)
    expect(useDocumentStore.getState().buffers[path]).toBeUndefined()
    await actions.saveFile()
    expect(readTextFile).not.toHaveBeenCalled()
    expect(writeTextFile).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
    await actions.closeTab(path)
    expect(useDocumentStore.getState().document.body).toBe('unsaved A')
    expect(useDocumentStore.getState().document.dirty).toBe(true)
  })
  it('preserves the focused document for restart when saving all buffers', async () => {
    useDocumentStore.getState().loadFromRaw('/a.md', 'A')
    useTabStore.getState().reset('/a.md')
    useDocumentStore.getState().setBody('edited A')
    await actions.openFile('/b.md')
    useDocumentStore.getState().setBody('edited B')
    await actions.openFile('/a.md')
    await actions.saveAll()
    expect(state.lastFile).toBe('/a.md')
    expect(useDocumentStore.getState().document.path).toBe('/a.md')
    expect(useTabStore.getState().active).toBe('/a.md')
    expect(Object.values(useDocumentStore.getState().buffers).every((document) => !document.dirty)).toBe(true)
  })
  it('saves an inactive dirty buffer when closing it', async () => {
    useDocumentStore.getState().loadFromRaw('/a.md', 'A')
    useTabStore.getState().reset('/a.md')
    useDocumentStore.getState().setBody('dirty A')
    await actions.openFile('/b.md')
    await actions.closeTab('/a.md')
    expect(writeTextFile).toHaveBeenCalledWith('/a.md', 'dirty A')
    expect(useDocumentStore.getState().document.path).toBe('/b.md')
    expect(useDocumentStore.getState().buffers['/a.md']).toBeUndefined()
  })
  it('retains dirty edits made during a save and refuses to close them', async () => {
    useDocumentStore.getState().loadFromRaw('/a.md', 'A')
    useTabStore.getState().reset('/a.md')
    useDocumentStore.getState().setBody('saving')
    vi.mocked(writeTextFile).mockImplementationOnce(async () => { useDocumentStore.getState().setBody('newer') })
    await expect(actions.closeTab('/a.md')).rejects.toThrow('changed while saving')
    expect(useDocumentStore.getState().document.body).toBe('newer')
    expect(useTabStore.getState().paths).toContain('/a.md')
  })
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
  it('keeps dirty buffers when switching without rereading or overwriting them', async () => {
    useDocumentStore.getState().loadFromRaw('/workspace/Draft/one.md', '# Original')
    useDocumentStore.getState().setBody('# Edited')

    await actions.openFile('/workspace/Draft/two.md')

    expect(writeTextFile).not.toHaveBeenCalled()
    expect(useDocumentStore.getState().buffers['/workspace/Draft/one.md'].body).toBe('# Edited')
    expect(useDocumentStore.getState().document.path).toBe('/workspace/Draft/two.md')
    expect(useDocumentStore.getState().document.body).toBe('# Next chapter')
    await actions.openFile('/workspace/Draft/one.md')
    expect(useDocumentStore.getState().document.body).toBe('# Edited')
    expect(readTextFile).toHaveBeenCalledTimes(1)
  })

  it('keeps dirty content visible when saving the old file fails', async () => {
    useDocumentStore.getState().loadFromRaw('/workspace/Draft/one.md', '# Original')
    useDocumentStore.getState().setBody('# Edited')
    vi.mocked(writeTextFile).mockRejectedValueOnce(new Error('Disk full'))

    await expect(actions.saveFile()).rejects.toThrow('Disk full')

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
    expect(writeTextFile).toHaveBeenCalledWith('/workspace/Draft/Chapter 1/Welcome.md', expect.stringContaining('# Welcome to Grimoire Maker'), { createNew: true })
    expect(useDocumentStore.getState().document.path).toBe('/workspace/Draft/Chapter 1/Welcome.md')
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
    expect(mkdir).toHaveBeenCalledTimes(5)
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

describe('contextual imports and binder moves', () => {
  it.each(['Draft', 'Research'] as const)('imports into the active file section: %s', async (section) => {
    useDocumentStore.getState().setWorkspace('/workspace', [])
    useTabStore.getState().reset(`/workspace/${section}/chapter/note.md`)
    vi.mocked(open).mockResolvedValueOnce(['/incoming/picture.png'])
    vi.mocked(stat).mockResolvedValue({ size: 3, isFile: true } as Awaited<ReturnType<typeof stat>>)
    vi.mocked(readFile).mockResolvedValue(new Uint8Array([1, 2, 3]))
    await actions.importInto()
    expect(open).toHaveBeenCalledWith({ multiple: true, directory: false, title: `Import into ${section}` })
    expect(writeFile).toHaveBeenCalledWith(`/workspace/${section}/picture.png`, new Uint8Array([1, 2, 3]), { createNew: true })
  })

  it('uses the clicked section instead of the active document', async () => {
    useDocumentStore.getState().setWorkspace('/workspace', [])
    useTabStore.getState().reset('/workspace/Draft/note.md')
    useExplorerStore.getState().selectPath('/workspace/Research')
    vi.mocked(open).mockResolvedValueOnce(['/incoming/note.md'])
    vi.mocked(stat).mockResolvedValue({ size: 1, isFile: true } as Awaited<ReturnType<typeof stat>>)
    vi.mocked(readFile).mockResolvedValue(new Uint8Array([42]))
    await actions.importInto()
    expect(writeFile).toHaveBeenCalledWith('/workspace/Research/note.md', new Uint8Array([42]), { createNew: true })
  })

  it.each([
    ['Draft', 'Research'], ['Draft', 'Trash'], ['Research', 'Draft'],
    ['Research', 'Trash'], ['Trash', 'Draft'], ['Trash', 'Research'],
  ])('moves %s to %s without losing unsaved text or tabs', async (from, to) => {
    const source = `/workspace/${from}/note.md`
    const target = `/workspace/${to}/note.md`
    useDocumentStore.getState().setWorkspace('/workspace', [])
    useDocumentStore.getState().loadFromRaw(source, 'Saved')
    useDocumentStore.getState().setBody('Unsaved')
    useTabStore.getState().reset(source)
    await actions.moveEntry(source, target)
    expect(rename).toHaveBeenCalledWith(source, target)
    expect(useTabStore.getState().active).toBe(target)
    expect(useDocumentStore.getState().document).toMatchObject({ path: target, body: 'Unsaved', dirty: true })
    expect(writeTextFile).not.toHaveBeenCalled()
  })
})

describe('applying templates', () => {
  const template = {
    id: 'pack', label: 'Pack', frontmatter: { title: 'Pack' }, body: '# Starting chapter', builtin: false,
    location: { kind: 'package' as const, path: '/config/templates/pack' },
  }

  it('applies a standalone folder template without requiring a project', async () => {
    expect(await actions.applyTemplate({ ...template, requiresProject: false })).toBe(true)
    expect(useDocumentStore.getState().document.body).toBe('# Starting chapter')
    expect(useDocumentStore.getState().document.path).toBeNull()
    expect(applyTemplateFiles).not.toHaveBeenCalled()
  })

  it('keeps project-dependent packages blocked without modifying the editor', async () => {
    useDocumentStore.getState().loadFromRaw(null, '# Notes')
    await expect(actions.applyTemplate({ ...template, requiresProject: true })).rejects.toThrow('Open a project folder')
    expect(useDocumentStore.getState().document.body).toBe('# Notes')
    expect(applyTemplateFiles).not.toHaveBeenCalled()
  })

  it('creates project documents and opens the index without Save As for a clean editor', async () => {
    useDocumentStore.getState().setWorkspace('/workspace', [])

    expect(await actions.applyTemplate(template)).toBe(true)

    expect(applyTemplateFiles).toHaveBeenCalledWith(template, '/workspace')
    expect(useDocumentStore.getState().document.path).toBe('/workspace/Draft/pack/index.md')
    expect(useDocumentStore.getState().document.body).toBe('# Starting chapter')
    expect(save).not.toHaveBeenCalled()
  })

  it('does not create files when saving an edited unsaved document is cancelled', async () => {
    useDocumentStore.getState().setWorkspace('/workspace', [])
    useDocumentStore.getState().setBody('# Personal notes')
    vi.mocked(save).mockResolvedValueOnce(null)

    expect(await actions.applyTemplate(template)).toBe(false)

    expect(applyTemplateFiles).not.toHaveBeenCalled()
    expect(useDocumentStore.getState().document.body).toBe('# Personal notes')
  })
})


it('restores appearance from setting.json rather than stale session settings', async () => {
  state.settings = { theme: 'parchment', columns: 2, pageSize: 'a4' }
  const rulerGuides = [{ id: 'guide-1', axis: 'column' as const, positionMm: 72 }]
  vi.mocked(loadSettings).mockResolvedValue({ theme: 'sci-fi', columns: 1, pageSize: 'letter', rulerGuides, zoom: 1.5 })
  await act(async () => actions.restoreSession())
  expect(useSettingsStore.getState()).toMatchObject({ theme: 'sci-fi', columns: 1, pageSize: 'letter', rulerGuides, zoom: 1.5 })
  expect(state.settings.theme).toBe('parchment')
})

it('autosaves named dirty buffers without dialogs or switching the focused tab', async () => {
  const store = useDocumentStore.getState()
  store.loadFromRaw('/a.md', 'A'); store.setBody('edited A')
  store.loadFromRaw('/b.md', 'B'); store.setBody('edited B')
  store.loadFromRaw(null, ''); store.setBody('untitled edit')
  useTabStore.getState().reset(null)
  await actions.autoSave()
  expect(writeTextFile).toHaveBeenCalledWith('/a.md', 'edited A')
  expect(writeTextFile).toHaveBeenCalledWith('/b.md', 'edited B')
  expect(writeTextFile).toHaveBeenCalledTimes(2)
  expect(save).not.toHaveBeenCalled()
  expect(useDocumentStore.getState().document.path).toBeNull()
  expect(useDocumentStore.getState().document.dirty).toBe(true)
  expect(useTabStore.getState().active).toBeNull()
})

it('autosave preserves edits made during writing and continues after an individual failure', async () => {
  const store = useDocumentStore.getState()
  store.loadFromRaw('/a.md', 'A'); store.setBody('edited A')
  store.loadFromRaw('/b.md', 'B'); store.setBody('edited B')
  vi.mocked(writeTextFile).mockImplementationOnce(async () => { throw new Error('disk full') })
  vi.mocked(writeTextFile).mockImplementationOnce(async () => { useDocumentStore.getState().setBody('newer B') })
  await expect(actions.autoSave()).rejects.toThrow('disk full')
  expect(writeTextFile).toHaveBeenCalledTimes(2)
  expect(useDocumentStore.getState().buffers['/a.md'].dirty).toBe(true)
  expect(useDocumentStore.getState().document.dirty).toBe(true)
  expect(useDocumentStore.getState().document.body).toBe('newer B')
  expect(useSessionStore.getState().workspaceError).toContain('disk full')
})

it.each(['manual-first', 'automatic-first'])('serializes both save paths (%s) and takes queued snapshots at execution time', async (order) => {
  const store = useDocumentStore.getState()
  store.loadFromRaw('/a.md', 'A'); store.setBody('first')
  useTabStore.getState().reset('/a.md')
  let finish!: () => void
  vi.mocked(writeTextFile).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  const first = order === 'manual-first' ? actions.saveFile() : actions.autoSave()
  await vi.waitFor(() => expect(writeTextFile).toHaveBeenCalledOnce())
  store.setBody('second')
  const second = order === 'manual-first' ? actions.autoSave() : actions.saveFile()
  await Promise.resolve()
  expect(writeTextFile).toHaveBeenCalledOnce()
  finish(); await first; await second
  expect(writeTextFile).toHaveBeenNthCalledWith(2, '/a.md', 'second')
  expect(useDocumentStore.getState().document.dirty).toBe(false)
})

it('restores the configured auto save interval, with a five-minute default for older settings', async () => {
  vi.mocked(loadSettings).mockResolvedValueOnce({ autoSaveSeconds: 90 })
  await actions.restoreSession()
  expect(useSettingsStore.getState().autoSaveSeconds).toBe(90)
  await actions.restoreSession()
  expect(useSettingsStore.getState().autoSaveSeconds).toBe(300)
})


it('hydrates auto commits including explicit false and restores defaults for legacy settings', async () => {
  vi.mocked(loadSettings).mockResolvedValueOnce({ autoCommitEnabled: false, autoCommitMinutes: 45, autoCommitMessage: 'Saved writing' })
  await actions.restoreSession()
  expect(useSettingsStore.getState()).toMatchObject({ autoCommitEnabled: false, autoCommitMinutes: 45, autoCommitMessage: 'Saved writing' })
  await actions.restoreSession()
  expect(useSettingsStore.getState()).toMatchObject({ autoCommitEnabled: true, autoCommitMinutes: 20, autoCommitMessage: 'update content automatically' })
})

describe('file rename references', () => {
  it('rewrites closed files and latest dirty buffers without saving unsaved content', async () => {
    const before = '---\ntitle: Chapter\n---\n![map](../Assets/map.jpg)'
    useDocumentStore.getState().setWorkspace('/workspace', [])
    useDocumentStore.getState().loadFromRaw('/workspace/Draft/open.md', before)
    useDocumentStore.getState().setBody('Unsaved ![map](../Assets/map.jpg)')
    useDocumentStore.getState().loadFromRaw('/workspace/Research/inactive.md', '![map](../Assets/map.jpg)')
    useDocumentStore.getState().activate('/workspace/Draft/open.md')
    vi.mocked(stat).mockResolvedValue({ isFile: true, isDirectory: false } as Awaited<ReturnType<typeof stat>>)
    let finish!: () => void
    let started!: () => void
    const committing = new Promise<void>(resolve => { started = resolve })
    const committed = new Promise<void>(resolve => { finish = resolve })
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === 'snapshot_rename_references') return { documents: [
        { path: '/workspace/Draft/open.md', before },
        { path: '/workspace/Draft/closed.md', before: '[map](../Assets/map.jpg#detail)' },
        { path: '/workspace/Research/inactive.md', before: '![map](../Assets/map.jpg)' },
      ] }
      if (command === 'commit_rename_references') { started(); await committed }
    })
    const operation = actions.renameEntry('/workspace/Assets/map.jpg', 'renamed.jpg')
    await committing
    useDocumentStore.getState().setBody('Typed during rename ![map](../Assets/map.jpg)')
    finish()
    await operation
    const state = useDocumentStore.getState()
    expect(state.document.body).toBe('Typed during rename ![map](../Assets/renamed.jpg)')
    expect(state.document.dirty).toBe(true)
    expect(state.buffers['/workspace/Research/inactive.md'].body).toBe('![map](../Assets/renamed.jpg)')
    expect(state.buffers['/workspace/Research/inactive.md'].dirty).toBe(false)
    expect(invoke).toHaveBeenCalledWith('commit_rename_references', expect.objectContaining({
      documents: expect.arrayContaining([
        { path: '/workspace/Draft/open.md', before, after: before.replace('map.jpg', 'renamed.jpg') },
        { path: '/workspace/Draft/closed.md', before: '[map](../Assets/map.jpg#detail)', after: '[map](../Assets/renamed.jpg#detail)' },
      ]),
    }))
    expect(writeTextFile).not.toHaveBeenCalled()
    expect(rename).not.toHaveBeenCalled()
  })

  it('does not change buffers or tabs when the native rename fails', async () => {
    useDocumentStore.getState().setWorkspace('/workspace', [])
    useDocumentStore.getState().loadFromRaw('/workspace/Draft/old.md', '[self](old.md)')
    useTabStore.getState().open('/workspace/Draft/old.md', true)
    vi.mocked(stat).mockResolvedValue({ isFile: true, isDirectory: false } as Awaited<ReturnType<typeof stat>>)
    vi.mocked(invoke).mockImplementation(async command => {
      if (command === 'snapshot_rename_references') return { documents: [{ path: '/workspace/Draft/old.md', before: '[self](old.md)' }] }
      throw new Error('Document changed outside the app')
    })
    await expect(actions.renameEntry('/workspace/Draft/old.md', 'new.md')).rejects.toThrow('changed outside')
    expect(useDocumentStore.getState().document.path).toBe('/workspace/Draft/old.md')
    expect(useDocumentStore.getState().document.body).toBe('[self](old.md)')
    expect(useTabStore.getState().active).toBe('/workspace/Draft/old.md')
  })
})
