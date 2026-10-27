// The size and quality every evidence image is captured at: camera photos (CameraCapture)
// and the linehaul scan (lib/scan/scanLinehaulSheet) share them so the two can't drift.

// Longest-edge cap applied on every capture path. Captured photos live as base64 data
// URLs in React state and localStorage evidence drafts (lib/types/evidence-draft.ts) —
// an uncompressed phone photo is 5–12 MB, which blows the ~5 MB localStorage quota and
// guarantees rejection against the backend's 10 MB artifact cap. 1600px keeps seals and
// documents legible at a fraction of the size.
export const EVIDENCE_PHOTO_MAX_EDGE_PX = 1600

export const EVIDENCE_PHOTO_JPEG_QUALITY_PERCENT = 70
