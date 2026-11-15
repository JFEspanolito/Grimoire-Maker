import { listOfficialPlugins } from '../../officialPlugins'

/** Historical sources retained only for installed-copy regression tests. */
const files = import.meta.glob('./*/**/*.{md,ts,tsx,js,css,json}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const examples = Object.fromEntries(Object.entries(files).map(([path, text]) => [`Legacy/${path.slice(2)}`, text]))
export const LEGACY_PLUGINS = listOfficialPlugins(examples, 'Legacy')
