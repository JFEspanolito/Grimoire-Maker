import { useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open, save } from '@tauri-apps/plugin-dialog'
import { exists, mkdir, readDir, readTextFile, rename, writeTextFile, readFile, writeFile, stat } from '@tauri-apps/plugin-fs'
import { importFiles, type ImportSection } from '../lib/fileImport'
import { useDocumentStore } from '../stores/documentStore'
import { useSessionStore } from '../stores/sessionStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useTabStore } from '../stores/tabStore'
import {
  loadAppState,
  rememberWorkspace,
  updateAppState,
  withAppStateLock,
  type AppState,
} from '../lib/appState'
import { remapPath, setupBinder, splitBinder } from '../lib/binder'
import { serializeDocument } from '../lib/frontmatter'
import { applyTemplateFiles } from '../lib/templateActions'
import type { Template } from '../lib/templates'
import { emitPluginEvent } from '../plugins/plugin-manager'
import { PAGE_SIZES, type FileNode, type GrimoireDocument } from '../types/document'

export const isTauri = (): boolean => '__TAURI_INTERNALS__' in window

async function readTree(dir: string): Promise<FileNode[]> {
  const entries = await readDir(dir)
  const nodes = await Promise.all(
    entries
      .filter((e) => !e.name.startsWith('.'))
      .map(async (e): Promise<FileNode> => {
        const path = `${dir}/${e.name}`
        return e.isDirectory
          ? { name: e.name, path, isDirectory: true, children: await readTree(path) }
          : { name: e.name, path, isDirectory: false }
      }),
  )
  return nodes.sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name))
}

const parentOf = (path: string): string => path.slice(0, path.lastIndexOf('/'))
let pendingRestore: Promise<void> | null = null
let fileActionQueue: Promise<unknown> = Promise.resolve()

function runFileAction<T>(action: () => Promise<T>): Promise<T> {
  const next = fileActionQueue.then(action)
  fileActionQueue = next.catch(() => undefined)
  return next
}

function remapTree(nodes: FileNode[], from: string, to: string): FileNode[] {
  return nodes.map((node) => ({
    ...node,
    path: remapPath(node.path, from, to) ?? node.path,
    children: node.children ? remapTree(node.children, from, to) : undefined,
  }))
}

function firstMarkdown(nodes: FileNode[]): string | null {
  for (const node of nodes) {
    if (node.isDirectory) {
      const found = firstMarkdown(node.children ?? [])
      if (found) return found
    } else if (/\.md$/i.test(node.name)) return node.path
  }
  return null
}

function validateName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed || /[\\/:*?"<>|]/.test(trimmed) || trimmed.startsWith('.')) {
    throw new Error(`Invalid name: "${name}"`)
  }
  return trimmed
}

export function useFileSystem() {
  const { loadFromRaw, setWorkspace } = useDocumentStore.getState()

  /** Persists a change to what survives a restart; a failed write never blocks the user. */
  const remember = useCallback(async (change: (state: AppState) => AppState) => {
    try {
      const state = await updateAppState(change)
      useSessionStore.getState().setRecentWorkspaces(state.recentWorkspaces)
    } catch (e) {
      console.warn('Could not save app state', e)
      useSessionStore.getState().setWorkspaceError(`Could not save session: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [])

  const persistDocument = useCallback(async (snapshot: GrimoireDocument): Promise<boolean> => {
    let path = snapshot.path
    path ??= await save({ filters: [{ name: 'Markdown', extensions: ['md'] }] })
    if (!path) return false
    await writeTextFile(path, serializeDocument(snapshot.frontmatter, snapshot.body))
    useDocumentStore.getState().markSnapshotSaved(path, snapshot)
    if (useDocumentStore.getState().document.path === path) useTabStore.getState().open(path, true)
    emitPluginEvent('document:saved')
    await remember((s) => ({ ...s, lastFile: useTabStore.getState().active }))
    return true
  }, [remember])

  const persistCurrentDocument = useCallback(() => persistDocument(useDocumentStore.getState().document), [persistDocument])

  const saveAllDocuments = useCallback(async () => {
    const state = useDocumentStore.getState()
    const documents = Object.values({ ...state.buffers, [state.document.path ?? '__untitled__']: state.document })
    for (const document of documents) {
      if (document.dirty && !(await persistDocument(document))) return false
    }
    if (Object.values(useDocumentStore.getState().buffers).some((document) => document.dirty)) {
      throw new Error('Documents changed while saving. Save again before switching projects.')
    }
    return true
  }, [persistDocument])

  const activateWorkspace = useCallback(async (root: string) => {
    if (!(await saveAllDocuments())) return
    await setupBinder({ exists, mkdir }, root)
    const tree = await readTree(root)
    const previous = await loadAppState()
    const lastFile = previous.lastWorkspace === root && previous.lastFile?.startsWith(`${root}/`)
      && await exists(previous.lastFile) ? previous.lastFile : null
    const binder = splitBinder(tree)
    const initial = lastFile ?? firstMarkdown(binder
      ? [binder.draft, binder.research, ...binder.other].filter((node): node is FileNode => node !== null)
      : tree)
    const markdown = initial && /\.md$/i.test(initial)
    const raw = markdown ? await readTextFile(initial) : ''
    setWorkspace(root, tree)
    useDocumentStore.getState().resetDocuments()
    if (!initial || markdown) loadFromRaw(initial, raw)
    useTabStore.getState().reset(initial)
    useSessionStore.getState().setWorkspaceError(null)
    await remember((state) => ({ ...rememberWorkspace(root)(state), lastFile: initial }))
  }, [loadFromRaw, saveAllDocuments, remember, setWorkspace])

  const openWorkspace = useCallback(async () => {
    if (!isTauri()) return
    // `recursive` grants the fs scope to subfolders, needed outside $HOME/$DOCUMENT/$DESKTOP.
    const dir = await open({ directory: true, recursive: true })
    if (typeof dir !== 'string') return
    await runFileAction(() => activateWorkspace(dir.replaceAll('\\', '/')))
  }, [activateWorkspace])

  /** Reopens a remembered folder; one that no longer opens is dropped from the list. */
  const openRecent = useCallback(
    async (path: string) => {
      try {
        await invoke('restore_workspace', { path })
        await runFileAction(() => activateWorkspace(path))
      } catch (e) {
        throw new Error(`Could not open "${path}": ${e instanceof Error ? e.message : String(e)}`)
      }
    },
    [activateWorkspace],
  )

  const refreshTree = useCallback(async () => {
    const root = useDocumentStore.getState().workspaceRoot
    if (root) setWorkspace(root, await readTree(root))
  }, [setWorkspace])

  const createFile = useCallback(
    async (dir: string, name: string) => {
      const clean = validateName(name)
      const path = `${dir}/${/\.[^.]+$/.test(clean) ? clean : `${clean}.md`}`
      if (await exists(path)) throw new Error(`"${path}" already exists`)
      await writeTextFile(path, '')
      await refreshTree()
      return path
    },
    [refreshTree],
  )

  const createFolder = useCallback(
    async (dir: string, name: string) => {
      const path = `${dir}/${validateName(name)}`
      if (await exists(path)) throw new Error(`"${path}" already exists`)
      await mkdir(path)
      await refreshTree()
    },
    [refreshTree],
  )

  /** Moves or renames `from` to `to`, keeping the open document pointed at its file. */
  const moveEntry = useCallback(
    (from: string, to: string) => runFileAction(async () => {
      if (from === to) return
      if (to.startsWith(`${from}/`)) throw new Error('Cannot move a folder into itself')
      if (await exists(to)) throw new Error(`"${to}" already exists`)
      await rename(from, to)
      useDocumentStore.getState().remapDocuments(from, to)
      useTabStore.getState().remap(from, to)
      await refreshTree()
    }),
    [refreshTree],
  )

  const renameEntry = useCallback(
    (path: string, name: string) => moveEntry(path, `${parentOf(path)}/${validateName(name)}`),
    [moveEntry],
  )

  const openFolder = useCallback(async (path: string) => {
    await invoke('open_folder', { path })
  }, [])

  const openFile = useCallback(
    (path?: string, newTab = false) => runFileAction(async () => {
      if (!isTauri()) return
      const selected = path ?? (await open({ filters: [{ name: 'Documents and images', extensions: ['md', 'pdf', 'docx', 'doc', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'] }] }))
      if (typeof selected !== 'string') return
      const target = selected.replaceAll('\\', '/')
      const current = useDocumentStore.getState().document
      if (useTabStore.getState().active === target) {
        useTabStore.getState().open(target, newTab)
        return
      }
      if (!current.path && current.dirty && !(await persistCurrentDocument())) return
      if (current.path && !useTabStore.getState().paths.includes(current.path)) useTabStore.getState().open(current.path, true)
      const markdown = /\.md$/i.test(target)
      const raw = markdown && !useDocumentStore.getState().buffers[target] ? await readTextFile(target) : null
      // Read the latest buffer after I/O: typing while a file loads must retain its tab.
      const previous = useTabStore.getState().active
      const store = useDocumentStore.getState()
      const dirty = previous ? store.buffers[previous]?.dirty || (store.document.path === previous && store.document.dirty) : false
      if (markdown) {
        if (raw !== null) loadFromRaw(target, raw)
        else store.activate(target)
      } else store.deactivate()
      useTabStore.getState().open(target, newTab || !!dirty)
      if (previous && !useTabStore.getState().paths.includes(previous)) useDocumentStore.getState().forget(previous)
      useSettingsStore.getState().setViewMode('edit')
      await remember((s) => ({ ...s, lastFile: target }))
    }).catch((e: unknown) => {
      useSessionStore.getState().setWorkspaceError(`Could not open file: ${e instanceof Error ? e.message : String(e)}`)
      throw e
    }),
    [loadFromRaw, persistCurrentDocument, remember],
  )

  /** Brings back last session: page setup, workspace folder and the file that was open. */
  const restoreSession = useCallback((): Promise<void> => {
    if (!isTauri()) return Promise.resolve()
    if (pendingRestore) return pendingRestore
    pendingRestore = (async () => {
      const state = await loadAppState()
      useSessionStore.getState().setRecentWorkspaces(state.recentWorkspaces)

      const { pageSize, columns, theme } = state.settings
      const settings = useSettingsStore.getState()
      if (pageSize && pageSize in PAGE_SIZES) settings.setPageSize(pageSize)
      if (columns === 1 || columns === 2) settings.setColumns(columns)
      if (typeof theme === 'string') settings.setTheme(theme)

      const { lastWorkspace } = state
      if (!lastWorkspace) return
      try {
        await openRecent(lastWorkspace)
      } catch (e) {
        console.warn(e)
        useSessionStore.getState().setWorkspaceError(e instanceof Error ? e.message : String(e))
        return
      }
    })().finally(() => { pendingRestore = null })
    return pendingRestore
  }, [openRecent])

  const saveFile = useCallback(() => runFileAction(async () => {
    if (!isTauri()) return
    const tabs = useTabStore.getState()
    if (tabs.paths.length && (!tabs.active || !/\.md$/i.test(tabs.active))) return
    await persistCurrentDocument()
  }).catch((e: unknown) => {
    useSessionStore.getState().setWorkspaceError(`Could not save file: ${e instanceof Error ? e.message : String(e)}`)
    throw e
  }), [persistCurrentDocument])

  const closeTab = useCallback((path: string) => runFileAction(async () => {
    const tabs = useTabStore.getState()
    if (!tabs.paths.includes(path)) return
    const state = useDocumentStore.getState()
    const document = state.document.path === path ? state.document : state.buffers[path]
    if (document?.dirty && !(await persistDocument(document))) return
    if (useDocumentStore.getState().buffers[path]?.dirty) throw new Error('Document changed while saving. Save again before closing.')
    useTabStore.getState().remove(path)
    useDocumentStore.getState().forget(path)
    const next = useTabStore.getState().active
    if (next && /\.md$/i.test(next)) useDocumentStore.getState().activate(next)
    else if (next) useDocumentStore.getState().deactivate()
    else loadFromRaw(null, '')
    await remember((state) => ({ ...state, lastFile: next }))
  }).catch((error: unknown) => {
    useSessionStore.getState().setWorkspaceError(`Could not close file: ${error instanceof Error ? error.message : String(error)}`)
    throw error
  }), [loadFromRaw, persistDocument, remember])

  const applyTemplate = useCallback((template: Template) => runFileAction(async (): Promise<boolean> => {
    const root = useDocumentStore.getState().workspaceRoot
    if (!root && template.location?.kind === 'package' && template.requiresProject !== false) {
      throw new Error('Open a project folder to apply a package template')
    }
    if (useDocumentStore.getState().document.dirty && !(await persistCurrentDocument())) return false

    const path = root ? await applyTemplateFiles(template, root) : null
    const raw = serializeDocument(template.frontmatter, template.body)
    loadFromRaw(path, raw)
    if (path) {
      useTabStore.getState().open(path, true)
      await refreshTree()
      await remember((state) => ({ ...state, lastFile: path }))
    } else useTabStore.getState().reset(null)

    const { pageSize, columns, theme } = template.frontmatter
    const settings = useSettingsStore.getState()
    if (pageSize && pageSize in PAGE_SIZES) settings.setPageSize(pageSize)
    if (columns === 1 || columns === 2) settings.setColumns(columns)
    if (typeof theme === 'string') settings.setTheme(theme)
    return true
  }), [loadFromRaw, persistCurrentDocument, refreshTree, remember])

  const renameWorkspace = useCallback((name: string) => runFileAction(async () => {
    if (!isTauri()) throw new Error('Project renaming is available in the desktop app')
    const current = useDocumentStore.getState()
    const root = current.workspaceRoot
    if (!root) throw new Error('Open a project folder before renaming it')
    const next = await withAppStateLock(() => invoke<string>('rename_workspace', { path: root, name }))
    const state = useDocumentStore.getState()
    if (state.workspaceRoot === root) {
      useDocumentStore.getState().remapDocuments(root, next)
      useTabStore.getState().remap(root, next)
      setWorkspace(next, remapTree(state.tree, root, next))
      setWorkspace(next, await readTree(next))
    }
    useSessionStore.getState().setRecentWorkspaces((await loadAppState()).recentWorkspaces)
    useSessionStore.getState().setWorkspaceError(null)
    return next
  }).catch((e: unknown) => {
    useSessionStore.getState().setWorkspaceError(`Could not rename project: ${e instanceof Error ? e.message : String(e)}`)
    throw e
  }), [setWorkspace])

  const importInto = useCallback((section: ImportSection) => runFileAction(async () => {
    const root = useDocumentStore.getState().workspaceRoot
    if (!root || !isTauri()) return
    const selected = await open({ multiple: true, directory: false, title: `Import into ${section}` })
    if (!selected) return
    try {
      await importFiles(root, section, Array.isArray(selected) ? selected : [selected], { exists, stat, readFile, writeFile })
    } finally {
      // Earlier files in a multi-selection remain visible if a later copy fails.
      await refreshTree()
    }
  }), [refreshTree])

  const saveAll = useCallback(() => runFileAction(saveAllDocuments), [saveAllDocuments])

  return {
    saveAll,
    openRestored: (path: string) => runFileAction(() => activateWorkspace(path.replaceAll('\\', '/'))),
    importInto,
    openWorkspace,
    openRecent,
    restoreSession,
    openFile,
    saveFile,
    closeTab,
    applyTemplate,
    createFile,
    createFolder,
    renameEntry,
    openFolder,
    renameWorkspace,
    moveEntry,
  }
}
