import { getWorkspaceRoot, type GrimoirePlugin, type PluginContextActionContext } from '@grimoire/plugin-api'
import { useQuotes } from './quotesStore'
import { syncReferences } from './referencesManager'
import { QuotesButton } from './QuotesButton'

export const addToQuote = {
  id: 'quotes.add',
  label: 'Add to quote',
  when: ({ selectionText }: PluginContextActionContext) => selectionText.trim().length > 0,
  run({ selectionText, path }: PluginContextActionContext) {
    if (selectionText.trim().length > 0) {
      const quote = useQuotes.getState().add({
        quoteText: selectionText.trim(),
        text: selectionText.trim(),
        sourcePath: path ?? '',
      })
      if (quote) {
        const root = useQuotes.getState().root ?? getWorkspaceRoot()
        if (root) {
          void syncReferences(root, quote)
        }
      }
    }
  },
}

const quotes: GrimoirePlugin = {
  id: 'builtin.quotes',
  name: 'Quotes',
  version: '2.0.0',
  activate(api) {
    api.registerToolbar({ id: 'quotes.control', title: 'Quotes', component: QuotesButton })
    api.registerContextAction(addToQuote)
  },
}

export default quotes
