// One plural rule for every counted noun in the dispatcher, so "1 parcels unaccounted for"
// cannot reappear. Dispatcher-only on purpose: frontend/shared is a shared file.

const SINGULAR_COUNT = 1

/** "1 parcel", "0 parcels", "2 parcels". Pass `plural` for nouns that do not take an "s". */
export function countLabel(n: number, singular: string, plural: string = `${singular}s`): string {
  return `${n} ${n === SINGULAR_COUNT ? singular : plural}`
}
