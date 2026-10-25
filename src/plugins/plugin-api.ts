/** Version-one host bridge for trusted local plugins, not a security sandbox. */
export { useSettingsStore as usePageSettings } from '../stores/settingsStore'
export { PAGE_SIZES } from '../types/document'
export { GUIDE_AXIS } from '../types/ruler'
export type { GuideAxis, RulerGuide } from '../types/ruler'
export { editorSheetRect } from '../lib/imagePlacement'
export type { GrimoirePlugin, PluginApi, PluginSurface, PluginSurfaceWidget } from '../types/plugin'
import { useTabStore } from '../stores/tabStore'

export function useActivePath(): string | null {
  return useTabStore(state => state.active)
}
