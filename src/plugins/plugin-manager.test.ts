import { afterEach, expect, it, vi } from 'vitest'
import { emitPluginEvent, registerPlugin, unregisterPlugin, usePluginRegistry } from './plugin-manager'
import type { GrimoirePlugin, PluginApi } from '../types/plugin'

afterEach(() => {
  for (const plugin of usePluginRegistry.getState().plugins) unregisterPlugin(plugin.id)
})

it('owns contributions, styles, listeners and cleanup through disable', () => {
  const changed = vi.fn()
  const cleanup = vi.fn()
  const deactivate = vi.fn()
  let api!: PluginApi
  const plugin: GrimoirePlugin = { id: 'owned', name: 'Owned', version: '1', deactivate, activate(value) {
    api = value
    value.registerCommand({ id: 'command', label: 'Command', run: changed })
    value.registerToolbar({ id: 'toolbar', title: 'Toolbar', component: () => null })
    value.registerEditorTool({ id: 'tools', title: 'Tools', component: () => null })
    value.registerOverlay({ id: 'overlay', title: 'Overlay', component: () => null })
    value.registerPreviewToolbar({ id: 'preview', title: 'Preview', component: () => null })
    value.registerPageBehavior({ id: 'page', mount: () => cleanup })
    value.registerContextAction({ id: 'context', label: 'Context', run: changed })
    value.addStyle('.owned { color: red; }')
    value.on('document:changed', changed)
    value.onCleanup(cleanup)
  } }
  const dispose = registerPlugin(plugin)
  expect(usePluginRegistry.getState().toolbar).toHaveLength(1)
  expect(usePluginRegistry.getState().contextActions.map(action => action.id)).toEqual(['context'])
  emitPluginEvent('document:changed')
  expect(changed).toHaveBeenCalledOnce()
  dispose()
  dispose()
  expect(usePluginRegistry.getState().commands).toHaveLength(0)
  expect(usePluginRegistry.getState().pageBehaviors).toHaveLength(0)
  expect(usePluginRegistry.getState().contextActions).toHaveLength(0)
  expect(document.querySelector('[data-plugin-style="owned"]')).toBeNull()
  emitPluginEvent('document:changed')
  expect(changed).toHaveBeenCalledOnce()
  expect(cleanup).toHaveBeenCalledOnce()
  expect(deactivate).toHaveBeenCalledOnce()
  expect(() => api.registerToolbar({ id: 'late', title: 'Late', component: () => null })).toThrow('inactive')
})

it('rolls failed activation back without removing another plugin', () => {
  registerPlugin({ id: 'healthy', name: 'Healthy', version: '1', activate(api) {
    api.registerCommand({ id: 'healthy', label: 'Healthy', run() {} })
  } })
  const cleanup = vi.fn()
  expect(() => registerPlugin({ id: 'failed', name: 'Failed', version: '1', activate(api) {
    api.addStyle('.failed {}')
    api.registerCommand({ id: 'failed', label: 'Failed', run() {} })
    api.onCleanup(cleanup)
    throw new Error('Activation failed')
  } })).toThrow('Activation failed')
  expect(usePluginRegistry.getState().plugins.map(plugin => plugin.id)).toEqual(['healthy'])
  expect(usePluginRegistry.getState().commands.map(command => command.id)).toEqual(['healthy'])
  expect(document.querySelector('[data-plugin-style="failed"]')).toBeNull()
  expect(cleanup).toHaveBeenCalledOnce()
})

it('rejects a duplicate context action id', () => {
  registerPlugin({ id: 'one', name: 'One', version: '1', activate: api => api.registerContextAction({ id: 'dup', label: 'A', run() {} }) })
  expect(() => registerPlugin({ id: 'two', name: 'Two', version: '1', activate: api => api.registerContextAction({ id: 'dup', label: 'B', run() {} }) })).toThrow('Duplicate contextActions id: dup')
})
