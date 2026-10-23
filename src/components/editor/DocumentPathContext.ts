import { createContext } from 'react'

/** Node views resolve relative assets against their own editor, not global focus. */
export const DocumentPathContext = createContext<string | null | undefined>(undefined)
