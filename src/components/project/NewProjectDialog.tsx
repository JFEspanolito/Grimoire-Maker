import { useEffect, useRef, useState } from 'react'

interface Props {
  onCreate: (name: string) => Promise<boolean>
  onClose: () => void
}

export function NewProjectDialog({ onCreate, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const locked = useRef(false)
  const [name, setName] = useState('My Grimoire')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])
  const create = async () => {
    if (locked.current || !name.trim()) return
    locked.current = true
    setBusy(true)
    setError('')
    try {
      if (await onCreate(name.trim())) onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      locked.current = false
      setBusy(false)
    }
  }
  return <dialog ref={dialog} aria-labelledby="new-project-title"
    className="m-auto w-96 max-w-[90vw] rounded-lg border border-white/20 bg-neutral-900 p-5 text-white shadow-xl backdrop:bg-black/60"
    onCancel={(event) => { event.preventDefault(); if (!locked.current) onClose() }}>
    <form onSubmit={(event) => { event.preventDefault(); void create() }}>
      <h2 id="new-project-title" className="mb-3 text-lg font-semibold">New Project</h2>
      <label className="block text-sm">Project name
        <input autoFocus required disabled={busy} value={name} onChange={(event) => setName(event.target.value)}
          className="mt-1 w-full rounded border border-white/20 bg-white/10 px-2 py-1 outline-amber-400" />
      </label>
      <p className="my-3 text-sm text-white/60">Choose where to create this folder next. It will contain Draft, Research, Trash, and a Chapter 1 demo.</p>
      {error && <p role="alert" className="mb-3 text-sm text-red-400">{error}</p>}
      <div className="flex justify-end gap-2 text-sm">
        <button type="button" disabled={busy} onClick={onClose} className="rounded px-3 py-2 hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-amber-400 disabled:opacity-30">Cancel</button>
        <button type="submit" disabled={busy || !name.trim()} className="rounded bg-white/10 px-3 py-2 hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-amber-400 disabled:opacity-30">
          {busy ? 'Creating…' : 'Choose Location & Create'}
        </button>
      </div>
    </form>
  </dialog>
}
