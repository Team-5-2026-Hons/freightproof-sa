import type { Precinct } from '@shared/lib/types/precinct'
import { splitPrecinctName } from '@shared/lib/utils/precinct-name'

export const NO_ROUTE_NAME = '—'

/** The area part of a precinct name, for a list cell or a sort. Names read "Cape Town · Depot";
 *  the area is what tells routes apart at a glance. An unknown or missing precinct gives a dash,
 *  which is also what the cell shows, so sorting and display never disagree. */
export function routeShortName(precincts: readonly Precinct[], id: string | null): string {
  const name = precincts.find(p => p.id === id)?.name
  return name === undefined ? NO_ROUTE_NAME : splitPrecinctName(name).place.trim()
}
