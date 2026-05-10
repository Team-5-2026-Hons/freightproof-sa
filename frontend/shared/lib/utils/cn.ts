// Joins class names, filtering out falsy values.
// Mirrors the clsx API subset used throughout the codebase.
export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ')
}
