import { create } from 'zustand'

export interface Toast {
  id: number
  message: string
}

interface ToastState {
  toasts: Toast[]
  /** Shows a short notice; it removes itself after `ms` milliseconds. Returns its id. */
  show: (message: string, ms?: number) => number
  dismiss: (id: number) => void
}

let next = 1

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  show: (message, ms = 4000) => {
    const id = next++
    set((state) => ({ toasts: [...state.toasts, { id, message }] }))
    if (ms > 0) setTimeout(() => get().dismiss(id), ms)
    return id
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}))
