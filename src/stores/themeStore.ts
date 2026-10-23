import { create } from 'zustand'
import {
  BUILTIN_THEMES,
  installBuiltinThemes,
  loadUserThemes,
  type ThemeInfo,
} from '../lib/themes'

installBuiltinThemes()

interface ThemeState {
  /** Everything selectable: built-ins, then mods, then themes shipped by templates. */
  themes: ThemeInfo[]
  userThemes: ThemeInfo[]
  templateThemes: ThemeInfo[]
  /** User themes folder; null until the first successful scan. */
  dir: string | null
  errors: string[]
  reload: () => Promise<void>
  setTemplateThemes: (themes: ThemeInfo[]) => void
}

const merge = (user: ThemeInfo[], fromTemplates: ThemeInfo[]): ThemeInfo[] => [
  ...BUILTIN_THEMES,
  ...user,
  ...fromTemplates,
]

export const useThemeStore = create<ThemeState>((set) => ({
  themes: BUILTIN_THEMES,
  userThemes: [],
  templateThemes: [],
  dir: null,
  errors: [],
  reload: async () => {
    try {
      const { dir, themes, errors } = await loadUserThemes()
      set((s) => ({ userThemes: themes, themes: merge(themes, s.templateThemes), dir, errors }))
    } catch (e) {
      set({ errors: [`Could not read the themes folder: ${e instanceof Error ? e.message : String(e)}`] })
    }
  },
  setTemplateThemes: (templateThemes) =>
    set((s) => ({ templateThemes, themes: merge(s.userThemes, templateThemes) })),
}))
