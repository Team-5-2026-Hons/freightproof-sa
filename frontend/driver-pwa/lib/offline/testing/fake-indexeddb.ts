// Minimal in-memory IndexedDB for tests. jsdom ships none and we may not add the
// fake-indexeddb package, so this implements only what the offline stores
// (exception-store, substitution-store) use (open/upgrade, transaction,
// objectStore get/put/delete/getAll) and lets the REAL store code run. Data lives in the factory, so reopening via the same factory behaves
// like an app restart.

type Listener<E> = ((event: E) => void) | null

interface FakeStoreSpec {
  keyPath: string
}

interface FakeDatabaseData {
  version: number
  stores: Map<string, { spec: FakeStoreSpec; rows: Map<string, unknown> }>
}

/** Test controls layered on top of the factory the store sees. */
export interface FakeIndexedDbControls {
  /** Make every following put reject with this error (QuotaExceededError by default). */
  failPuts(error?: DOMException): void
  /** Make open() fail, as in a browser with storage blocked. */
  setUnavailable(unavailable: boolean): void
}

export type FakeIndexedDbFactory = IDBFactory & FakeIndexedDbControls

function cloneRecord<T>(value: T): T {
  if (Array.isArray(value)) return value.map(cloneRecord) as unknown as T
  if (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = cloneRecord(v)
    return out as T
  }
  return value
}

class FakeRequest<T> {
  result!: T
  error: DOMException | null = null
  onsuccess: Listener<Event> = null
  onerror: Listener<Event> = null
  readyState: IDBRequestReadyState = 'pending'
}

class FakeTransaction {
  oncomplete: Listener<Event> = null
  onerror: Listener<Event> = null
  onabort: Listener<Event> = null
  error: DOMException | null = null
  private pending = 0
  private finished = false

  constructor(
    private readonly data: FakeDatabaseData,
    private readonly storeName: string,
    readonly mode: IDBTransactionMode,
    private readonly controls: { putError: DOMException | null },
  ) {
    setTimeout(() => this.maybeComplete(), 0)
  }

  objectStore(name: string): FakeObjectStore {
    if (name !== this.storeName) throw new DOMException('Store not in transaction', 'NotFoundError')
    return new FakeObjectStore(this, this.data.stores.get(name)!.rows, this.data.stores.get(name)!.spec, this.controls)
  }

  abort(): void {
    this.fail(new DOMException('Transaction aborted', 'AbortError'))
  }

  dispatch<T>(request: FakeRequest<T>, run: () => T): void {
    this.pending += 1
    setTimeout(() => {
      if (this.finished) return
      try {
        request.result = run()
        request.readyState = 'done'
        request.onsuccess?.({ target: request } as unknown as Event)
      } catch (err) {
        const error = err instanceof DOMException ? err : new DOMException(String(err), 'UnknownError')
        request.error = error
        request.readyState = 'done'
        this.pending -= 1
        request.onerror?.({ target: request } as unknown as Event)
        this.fail(error)
        return
      }
      this.pending -= 1
      this.maybeComplete()
    }, 0)
  }

  private fail(error: DOMException): void {
    if (this.finished) return
    this.finished = true
    this.error = error
    this.onerror?.({ target: this } as unknown as Event)
    this.onabort?.({ target: this } as unknown as Event)
  }

  private maybeComplete(): void {
    if (this.finished || this.pending > 0) return
    this.finished = true
    this.oncomplete?.({ target: this } as unknown as Event)
  }
}

class FakeObjectStore {
  constructor(
    private readonly tx: FakeTransaction,
    private readonly rows: Map<string, unknown>,
    private readonly spec: FakeStoreSpec,
    private readonly controls: { putError: DOMException | null },
  ) {}

  get(key: string): FakeRequest<unknown> {
    const request = new FakeRequest<unknown>()
    this.tx.dispatch(request, () => {
      const row = this.rows.get(key)
      return row === undefined ? undefined : cloneRecord(row)
    })
    return request
  }

  getAll(): FakeRequest<unknown[]> {
    const request = new FakeRequest<unknown[]>()
    this.tx.dispatch(request, () => [...this.rows.values()].map(cloneRecord))
    return request
  }

  put(value: unknown): FakeRequest<string> {
    const request = new FakeRequest<string>()
    this.tx.dispatch(request, () => {
      if (this.tx.mode === 'readonly') throw new DOMException('Read-only transaction', 'ReadOnlyError')
      if (this.controls.putError) throw this.controls.putError
      const key = (value as Record<string, unknown>)[this.spec.keyPath] as string
      this.rows.set(key, cloneRecord(value))
      return key
    })
    return request
  }

  delete(key: string): FakeRequest<undefined> {
    const request = new FakeRequest<undefined>()
    this.tx.dispatch(request, () => {
      if (this.tx.mode === 'readonly') throw new DOMException('Read-only transaction', 'ReadOnlyError')
      this.rows.delete(key)
      return undefined
    })
    return request
  }
}

class FakeDatabase {
  readonly objectStoreNames = {
    contains: (name: string): boolean => this.data.stores.has(name),
  }

  constructor(
    private readonly data: FakeDatabaseData,
    private readonly controls: { putError: DOMException | null },
  ) {}

  createObjectStore(name: string, options: { keyPath: string }): void {
    this.data.stores.set(name, { spec: { keyPath: options.keyPath }, rows: new Map() })
  }

  transaction(storeName: string, mode: IDBTransactionMode = 'readonly'): FakeTransaction {
    if (!this.data.stores.has(storeName)) throw new DOMException('No such store', 'NotFoundError')
    return new FakeTransaction(this.data, storeName, mode, this.controls)
  }

  close(): void {
  }
}

export function createFakeIndexedDb(): FakeIndexedDbFactory {
  const databases = new Map<string, FakeDatabaseData>()
  const controls: { putError: DOMException | null } = { putError: null }
  let unavailable = false

  const open = (name: string, version = 1) => {
    const request = {
      result: undefined as unknown,
      error: null as DOMException | null,
      onsuccess: null as Listener<Event>,
      onerror: null as Listener<Event>,
      onupgradeneeded: null as Listener<Event>,
      onblocked: null as Listener<Event>,
    }
    setTimeout(() => {
      if (unavailable) {
        request.error = new DOMException('Storage blocked', 'SecurityError')
        request.onerror?.({ target: request } as unknown as Event)
        return
      }
      let data = databases.get(name)
      const isNew = data === undefined
      if (!data) {
        data = { version: 0, stores: new Map() }
        databases.set(name, data)
      }
      const db = new FakeDatabase(data, controls)
      request.result = db
      if (isNew || data.version < version) {
        data.version = version
        request.onupgradeneeded?.({ target: request } as unknown as Event)
      }
      request.onsuccess?.({ target: request } as unknown as Event)
    }, 0)
    return request
  }

  const factory = {
    open,
    failPuts(error: DOMException = new DOMException('Disk full', 'QuotaExceededError')): void {
      controls.putError = error
    },
    setUnavailable(value: boolean): void {
      unavailable = value
    },
  }
  return factory as unknown as FakeIndexedDbFactory
}
