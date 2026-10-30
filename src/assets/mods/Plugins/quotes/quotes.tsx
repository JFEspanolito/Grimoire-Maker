import type { GrimoirePlugin, PluginContextActionContext } from '@grimoire/plugin-api'
import { useQuotes } from './quotesStore'
import { QuotesButton } from './QuotesButton'

export const addToQuote = {
  id: 'quotes.add',
  label: 'Add to quote',
  when: ({ selectionText }: PluginContextActionContext) => selectionText.trim().length > 0,
  run({ selectionText, path }: PluginContextActionContext) {
    if (selectionText.trim().length > 0) {
      useQuotes.getState().add({
        text: selectionText.trim(),
        sourcePath: path ?? '',
      })
    }
  },
}

const quotes: GrimoirePlugin = {
  id: 'builtin.quotes',
  name: 'Quotes',
  version: '1.0.0',
  activate(api) {
    api.registerToolbar({ id: 'quotes.control', title: 'Quotes', component: QuotesButton })
    api.registerContextAction(addToQuote)
  },
}

export default quotes
