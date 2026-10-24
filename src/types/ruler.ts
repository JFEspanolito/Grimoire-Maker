export const GUIDE_AXIS = { ROW: 'row', COLUMN: 'column' } as const
export type GuideAxis = (typeof GUIDE_AXIS)[keyof typeof GUIDE_AXIS]

export interface RulerGuide {
  id: string
  axis: GuideAxis
  /** Distance from the top (row) or left (column) edge of the sheet. */
  positionMm: number
}
