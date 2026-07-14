import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

// Standard shadcn/ui class combiner: clsx resolves conditional class arrays/objects,
// twMerge then dedupes conflicting Tailwind utilities (e.g. "px-2 px-4" -> "px-4") so
// a caller's className prop can safely override a component's own defaults.
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
