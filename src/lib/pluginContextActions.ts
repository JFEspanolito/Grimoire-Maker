import type { PluginContextAction, PluginContextActionContext } from '../types/plugin'
import { reportError } from './errorLogging'

export function contextActionApplies(action: PluginContextAction, context: PluginContextActionContext): boolean {
  try { return action.when ? action.when(context) === true : true }
  catch (error) { reportError('plugin.contextAction.when', error); return false }
}

export function runContextAction(action: PluginContextAction, context: PluginContextActionContext): void {
  try { void Promise.resolve(action.run(context)).catch(error => reportError('plugin.contextAction.run', error)) }
  catch (error) { reportError('plugin.contextAction.run', error) }
}
