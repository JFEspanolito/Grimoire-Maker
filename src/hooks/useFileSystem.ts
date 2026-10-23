import { useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open, save } from '@tauri-apps/plugin-dialog'
import { exists, mkdir, readDir, readTextFile, rename, writeTextFile } from '@tauri-apps/plugin-fs'
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
import { PAGE_SIZES, type FileNode } from '../types/document'

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
  const { loadFromRaw, toRaw, markSaved, setWorkspace, setPath } = useDocumentStore.getState()

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

  const persistCurrentDocument = useCallback(async (): Promise<boolean> => {
    let path = useDocumentStore.getState().document.path
    path ??= await save({ filters: [{ name: 'Markdown', extensions: ['md'] }] })
    if (!path) return false
    await writeTextFile(path, toRaw())
    markSaved(path)
    useTabStore.getState().open(path)
    emitPluginEvent('document:saved')
    await remember((s) => ({ ...s, lastFile: path }))
    return true
  }, [toRaw, markSaved, remember])

  const activateWorkspace = useCallback(async (root: string) => {
    const current = useDocumentStore.getState().document
    if (current.dirty && !(await persistCurrentDocument())) return
    await setupBinder({ exists, mkdir }, root)
    const tree = await readTree(root)
    const previous = await loadAppState()
    const lastFile = previous.lastWorkspace === root && previous.lastFile?.startsWith(`${root}/`)
      && await exists(previous.lastFile) ? previous.lastFile : null
    const binder = splitBinder(tree)
    const initial = lastFile ?? firstMarkdown(binder
      ? [binder.draft, binder.research, ...binder.other].filter((node): node is FileNode => node !== null)
      : tree)
    const raw = initial ? await readTextFile(initial) : ''
    setWorkspace(root, tree)
    loadFromRaw(initial, raw)
    useTabStore.getState().reset(initial)
    useSessionStore.getState().setWorkspaceError(null)
    await remember((state) => ({ ...rememberWorkspace(root)(state), lastFile: initial }))
  }, [loadFromRaw, persistCurrentDocument, remember, setWorkspace])

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
    async (from: string, to: string) => {
      if (from === to) return
      if (to.startsWith(`${from}/`)) throw new Error('Cannot move a folder into itself')
      if (await exists(to)) throw new Error(`"${to}" already exists`)
      await rename(from, to)
      const current = useDocumentStore.getState().document.path
      if (current === from) setPath(to)
      else if (current?.startsWith(`${from}/`)) setPath(to + current.slice(from.length))
      useTabStore.getState().remap(from, to)
      await refreshTree()
    },
    [refreshTree, setPath],
  )

  const renameEntry = useCallback(
    (path: string, name: string) => moveEntry(path, `${parentOf(path)}/${validateName(name)}`),
    [moveEntry],
  )

  const openFile = useCallback(
    (path?: string, newTab = false) => runFileAction(async () => {
      if (!isTauri()) return
      const target = path ?? (await open({ filters: [{ name: 'Markdown', extensions: ['md'] }] }))
      if (typeof target !== 'string') return
      const current = useDocumentStore.getState().document
      if (current.path === target) {
        useTabStore.getState().open(target, newTab)
        return
      }
      if (current.dirty && !(await persistCurrentDocument())) return
      loadFromRaw(target, await readTextFile(target))
      useTabStore.getState().open(target, newTab)
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
    await persistCurrentDocument()
  }).catch((e: unknown) => {
    useSessionStore.getState().setWorkspaceError(`Could not save file: ${e instanceof Error ? e.message : String(e)}`)
    throw e
  }), [persistCurrentDocument])

  const closeTab = useCallback((path: string) => runFileAction(async () => {
    const tabs = useTabStore.getState()
    if (!tabs.paths.includes(path)) return
    if (tabs.active !== path) {
      tabs.remove(path)
      return
    }
    if (useDocumentStore.getState().document.dirty && !(await persistCurrentDocument())) return
    const next = tabs.paths.find((candidate) => candidate !== path) ?? null
    const raw = next ? await readTextFile(next) : ''
    useTabStore.getState().remove(path)
    loadFromRaw(next, raw)
    if (next) useTabStore.getState().open(next)
    await remember((state) => ({ ...state, lastFile: next }))
  }), [loadFromRaw, persistCurrentDocument, remember])

  const applyTemplate = useCallback((template: Template) => runFileAction(async (): Promise<boolean> => {
    const root = useDocumentStore.getState().workspaceRoot
    if (!root && template.location?.kind === 'package') {
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
      const path = remapPath(state.document.path, root, next)
      if (path && path !== state.document.path) setPath(path)
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
  }), [setPath, setWorkspace])

  return {
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
    renameWorkspace,
    moveEntry,
  }
}
