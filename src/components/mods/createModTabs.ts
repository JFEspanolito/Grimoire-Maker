export const CREATE_MOD_TABS = ['Themes', 'Snippets', 'Templates'] as const
export type CreateModTab = (typeof CREATE_MOD_TABS)[number]
