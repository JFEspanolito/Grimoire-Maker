import { expect, it } from 'vitest'
import cargoSource from '../../src-tauri/Cargo.toml?raw'
import packageSource from '../../package.json?raw'
import tauriSource from '../../src-tauri/tauri.conf.json?raw'

const { version } = JSON.parse(packageSource) as { version: string }

it('keeps one app version: package.json, which Tauri reads and the crate must match', () => {
  expect(version).toMatch(/^\d+\.\d+\.\d+/)
  expect((JSON.parse(tauriSource) as { version: string }).version).toBe('../package.json')
  expect(/^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m.exec(cargoSource)?.[1]).toBe(version)
})
