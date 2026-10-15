// Photo decode + downscale shared by evidence capture (components/phase/CameraCapture)
// and the driver's profile photo (lib/profile/pick-driver-photo). Moved here unchanged
// from CameraCapture so both paths orient and compress a photo the same way.

interface DecodedPhoto {
  source: ImageBitmap | HTMLImageElement
  width: number
  height: number
  // Frees decode resources (bitmap memory / object URL) once the canvas draw is done.
  release: () => void
}

// createImageBitmap with imageOrientation: 'from-image' bakes the EXIF rotation in at
// decode time, so portrait phone photos don't land sideways on the canvas. WebViews that
// lack the option (or can't decode the format) fall back to an <img> decode — browsers
// have auto-oriented <img> per EXIF by default since 2020 (CSS image-orientation:
// from-image), so orientation survives that path too.
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
      // Not fatal — some WebViews reject the options bag or the file format. The <img>
      // fallback below gets its own shot at decoding before we give up.
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
      // The object URL must stay alive until drawImage has consumed it — release
      // revokes it only after the caller is done drawing.
      release: () => URL.revokeObjectURL(objectUrl),
    }
  } catch (err) {
    URL.revokeObjectURL(objectUrl)
    throw err
  }
}

// Downscale + re-encode the picked file BEFORE it reaches state/localStorage. The old
// raw FileReader path stored multi-MB base64 strings — quota risk for drafts and a
// guaranteed oversized upload later. Callers pass their own edge cap and quality —
// evidence photos keep detail (components/phase/CameraCapture), the avatar is tiny.
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
