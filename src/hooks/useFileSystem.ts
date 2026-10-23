import { useCallback } from 'react'
import { open, save } from '@tauri-apps/plugin-dialog'
import { exists, mkdir, readDir, readTextFile, rename, writeTextFile } from '@tauri-apps/plugin-fs'
import { useDocumentStore } from '../stores/documentStore'
import { emitPluginEvent } from '../plugins/plugin-manager'
import type { FileNode } from '../types/document'

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

function validateName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed || /[\\/:*?"<>|]/.test(trimmed) || trimmed.startsWith('.')) {
    throw new Error(`Invalid name: "${name}"`)
  }
  return trimmed
}

export function useFileSystem() {
  const { loadFromRaw, toRaw, markSaved, setWorkspace, setPath } = useDocumentStore.getState()

  const openWorkspace = useCallback(async () => {
    if (!isTauri()) return
    // `recursive` grants the fs scope to subfolders, needed outside $HOME/$DOCUMENT/$DESKTOP.
    const dir = await open({ directory: true, recursive: true })
    if (typeof dir !== 'string') return
    const root = dir.replaceAll('\\', '/')
    setWorkspace(root, await readTree(root))
  }, [setWorkspace])

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
      await refreshTree()
    },
    [refreshTree, setPath],
  )

  const renameEntry = useCallback(
    (path: string, name: string) => moveEntry(path, `${parentOf(path)}/${validateName(name)}`),
    [moveEntry],
  )

  const openFile = useCallback(
    async (path?: string) => {
      if (!isTauri()) return
      const target = path ?? (await open({ filters: [{ name: 'Markdown', extensions: ['md'] }] }))
      if (typeof target !== 'string') return
      loadFromRaw(target, await readTextFile(target))
    },
    [loadFromRaw],
  )

  const saveFile = useCallback(async () => {
    if (!isTauri()) return
    let path = useDocumentStore.getState().document.path
    path ??= await save({ filters: [{ name: 'Markdown', extensions: ['md'] }] })
    if (!path) return
    await writeTextFile(path, toRaw())
    markSaved(path)
    emitPluginEvent('document:saved')
  }, [toRaw, markSaved])

  return {
    openWorkspace,
    openFile,
    saveFile,
    createFile,
    createFolder,
    renameEntry,
    moveEntry,
  }
}
