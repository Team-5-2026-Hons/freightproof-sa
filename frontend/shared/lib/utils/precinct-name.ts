// Precinct names join a place and an area: "FedEx JHB · Linbro Park". Names saved before the
// UI moved to " · " use an em dash ("FedEx JHB — Linbro Park"), and stored names are never
// rewritten, so both separators are read. The middle dot needs spaces around it so a dot
// inside a name is not mistaken for a separator.
const PRECINCT_NAME_SEPARATOR = /\s+·\s+|\s*—\s*/

export interface PrecinctNameParts {
  place: string
  area: string | null
}

/** Splits a precinct name at its first separator; a name without one is all place. */
export function splitPrecinctName(name: string): PrecinctNameParts {
  const match = PRECINCT_NAME_SEPARATOR.exec(name)
  if (match === null) return { place: name, area: null }
  return { place: name.slice(0, match.index), area: name.slice(match.index + match[0].length) }
}
