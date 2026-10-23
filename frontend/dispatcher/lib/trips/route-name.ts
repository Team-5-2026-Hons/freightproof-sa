import type { Precinct } from '@shared/lib/types/precinct'

export const NO_ROUTE_NAME = '—'

/** Precinct names carry a place and an area joined by this separator, e.g. "Cape Town · Depot". */
export const PRECINCT_NAME_SEPARATOR = ' · '

/** The area part of a precinct name, for a list cell or a sort. Names read "Cape Town · Depot";
 *  the area is what tells routes apart at a glance. An unknown or missing precinct gives a dash,
 *  which is also what the cell shows, so sorting and display never disagree. */
export function routeShortName(precincts: readonly Precinct[], id: string | null): string {
  return precincts.find(p => p.id === id)?.name.split(PRECINCT_NAME_SEPARATOR)[0]?.trim() ?? NO_ROUTE_NAME
}
