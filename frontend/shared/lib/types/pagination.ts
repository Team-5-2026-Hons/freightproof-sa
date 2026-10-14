// Mirrors the backend's generic CursorPage[T] response envelope (schemas/pagination.py).
export interface CursorPage<T> {
  items: T[]
  next_cursor: string | null
  total_items: number
}
