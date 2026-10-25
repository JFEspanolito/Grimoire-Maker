export interface Contributor { name: string; socialMedia: string; platform: string }
export const CONTRIBUTOR_GROUPS = { coAuthors: 'Co-Author', artists: 'Artist' } as const
export type ContributorGroup = keyof typeof CONTRIBUTOR_GROUPS

export function validateContributors(value: unknown): Contributor[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error('Use at most 100 contributors per list.')
  return value.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('Invalid contributor.')
    const fields = item as Record<string, unknown>
    for (const key of ['name', 'socialMedia', 'platform'] as const) {
      if (typeof fields[key] !== 'string' || fields[key].length > 500) throw new Error('Contributor fields must be text of at most 500 characters.')
    }
    const { name, socialMedia, platform } = fields as unknown as Contributor
    if (!name.trim()) throw new Error('Each contributor needs a name.')
    return { name: name.trim(), socialMedia: socialMedia.trim(), platform: platform.trim() }
  })
}

export function coAuthorNames(project?: { coAuthor: string; coAuthors?: Contributor[] }): string {
  return project?.coAuthors?.map(item => item.name).join(', ') ?? project?.coAuthor ?? ''
}
