/** Query parameter naming the open settings section: /settings?section=display. */
export const SECTION_PARAM = 'section'

/** Ids of the settings sections. Kept apart from the section registry so a caller that only
 *  needs to link to one (the sidebar) does not import every section's component. */
export const SETTINGS_SECTION_IDS = {
  account: 'account',
  display: 'display',
  forensic: 'forensic',
} as const

export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[keyof typeof SETTINGS_SECTION_IDS]

/**
 * The section a URL asks for, among the ones this dispatcher may see.
 *
 * An unknown id, or an admin-only id for a regular dispatcher, falls back to the first
 * visible section instead of erroring or revealing that the section exists: a stale
 * bookmark should still land somewhere useful. `visible` always starts with Account,
 * which every role has.
 */
export function resolveSection<T extends { id: string }>(raw: string | null, visible: readonly T[]): T {
  return visible.find(section => section.id === raw) ?? visible[0]
}
