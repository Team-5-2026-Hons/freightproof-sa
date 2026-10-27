// Photo decode + downscale shared by evidence capture (components/phase/CameraCapture)
// and the driver's profile photo (lib/profile/pick-driver-photo). Moved here unchanged
// from CameraCapture so both paths orient and compress a photo the same way.

interface DecodedPhoto {
  source: ImageBitmap | HTMLImageElement
  width: number
  height: number
  release: () => void
}

async function decodePhoto(file: File): Promise<DecodedPhoto> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      }
    } catch (err) {
      console.warn('createImageBitmap failed — falling back to <img> decode', err)
    }
  }

  const objectUrl = URL.createObjectURL(file)
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Image decode failed'))
      img.src = objectUrl
    })
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      release: () => URL.revokeObjectURL(objectUrl),
    }
  } catch (err) {
    URL.revokeObjectURL(objectUrl)
    throw err
  }
}

export async function fileToCompressedJpegDataUrl(
  file: File,
  maxEdgePx: number,
  qualityPercent: number,
): Promise<string> {
  const decoded = await decodePhoto(file)
  try {
    const scale = Math.min(1, maxEdgePx / Math.max(decoded.width, decoded.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(decoded.width * scale))
    canvas.height = Math.max(1, Math.round(decoded.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    ctx.drawImage(decoded.source, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', qualityPercent / 100)
  } finally {
    decoded.release()
  }
}
