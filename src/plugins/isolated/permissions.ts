import type { ParsedRequest, Topic } from './protocol'

export interface PermissionInfo {
  /** Short text for the consent dialog. */
  label: string
  /** What it lets the plugin do, and what it does not. */
  description: string
}

/** The complete set. Content, file and network permissions deliberately do not exist (spec 5.2). */
export const PERMISSIONS = {
  'editor:zoom:read': { label: 'Read the zoom level', description: 'See the current editor zoom and be told when it changes.' },
  'editor:zoom:write': { label: 'Change the zoom level', description: 'Set the editor zoom between 25% and 300%.' },
  'editor:geometry:read': { label: 'Read page dimensions', description: 'See the page width, height and zoom. It never sees text, file names or paths.' },
  'editor:guides:read': { label: 'Read ruler guides', description: 'See the position of the guides on the page.' },
  'editor:guides:write': { label: 'Add and remove ruler guides', description: 'Create guides and remove guides on the page.' },
} as const satisfies Record<string, PermissionInfo>

export type Permission = keyof typeof PERMISSIONS

export const isPermission = (value: string): value is Permission => Object.hasOwn(PERMISSIONS, value)

type Operation = ParsedRequest['op']

/** Every operation names the single permission it needs; an operation without one cannot exist. */
const OPERATION_PERMISSION: Record<Exclude<Operation, 'subscribe' | 'unsubscribe'>, Permission> = {
  'zoom.get': 'editor:zoom:read',
  'zoom.set': 'editor:zoom:write',
  'geometry.get': 'editor:geometry:read',
  'guides.list': 'editor:guides:read',
  'guides.add': 'editor:guides:write',
  'guides.remove': 'editor:guides:write',
}

const TOPIC_PERMISSION: Record<Topic, Permission> = {
  zoom: 'editor:zoom:read',
  geometry: 'editor:geometry:read',
  guides: 'editor:guides:read',
}

export function permissionFor(request: ParsedRequest): Permission {
  return request.op === 'subscribe' || request.op === 'unsubscribe' ? TOPIC_PERMISSION[request.topic] : OPERATION_PERMISSION[request.op]
}

export const permissionForTopic = (topic: Topic): Permission => TOPIC_PERMISSION[topic]
