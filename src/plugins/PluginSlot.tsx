import { Component, type ReactNode } from 'react'
import { usePluginRegistry } from './plugin-manager'
import { reportError } from '../lib/errorLogging'

class PluginBoundary extends Component<{ children: ReactNode; identity: unknown; title: string }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error) { reportError('plugin.render', error) }
  componentDidUpdate(previous: Readonly<typeof this.props>) {
    if (previous.identity !== this.props.identity && this.state.failed) this.setState({ failed: false })
  }
  render() {
    return this.state.failed ? <span role="alert" title="Disable or fix the plugin, then refresh Mods.">{this.props.title}: plugin failed</span> : this.props.children
  }
}

/** A contribution is isolated so a rendering error does not remove the editor. */
export function PluginSlot({ slot }: { slot: 'toolbar' | 'editorTools' | 'overlays' | 'panels' }) {
  const panels = usePluginRegistry(state => state[slot])
  return panels.map(({ id, title, component: Widget }) =>
    <PluginBoundary key={id} identity={Widget} title={title}><Widget /></PluginBoundary>)
}

export { PluginBoundary }
