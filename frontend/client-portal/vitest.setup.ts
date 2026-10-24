// Extends Vitest's `expect` with jest-dom matchers (toBeInTheDocument, etc.).
import '@testing-library/jest-dom/vitest'

// jsdom's Blob/File lack arrayBuffer(), which every browser this portal targets has.
if (typeof Blob.prototype.arrayBuffer !== 'function') {
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as ArrayBuffer)
      reader.onerror = () => reject(reader.error)
      reader.readAsArrayBuffer(this)
    })
  }
}

// jsdom has no object URLs either; evidence photos build one per downloaded file.
if (typeof URL.createObjectURL !== 'function') {
  URL.createObjectURL = () => `blob:test/${Math.random().toString(36).slice(2)}`
  URL.revokeObjectURL = () => undefined
}
