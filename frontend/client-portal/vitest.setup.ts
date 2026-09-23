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
