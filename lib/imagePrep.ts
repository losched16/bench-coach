'use client'

// Getting a screenshot from a coach's phone to the vision API.
//
// Three things went wrong here, all silent:
//
//   1. There was no paste handler. A coach who screenshots a box score and
//      hits Cmd+V — the obvious gesture, and the one people actually use —
//      got nothing at all. No error, no image, just a form that ignored them.
//   2. Phone screenshots are big. A 12MP image base64-encoded blows past the
//      5MB per-image limit, and the request fails with something opaque.
//      Downscaling also makes the parse faster and cheaper with no loss of
//      legibility — a box score is text, and text survives resizing fine.
//   3. HEIC. Every photo taken on an iPhone is HEIC, no browser canvas can
//      decode it, and the API rejects it. That deserves a sentence telling
//      the coach what to do, not a generic failure.

// Claude's vision sweet spot. Beyond this the image is downscaled server-side
// anyway, so sending more is pure cost and latency.
const MAX_EDGE = 1568
const JPEG_QUALITY = 0.85

export interface PreparedImage {
  data: string       // base64, no data: prefix
  mimeType: string
  name: string
}

export const SUPPORTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

export class UnsupportedImageError extends Error {
  constructor(public fileName: string, public fileType: string) {
    super(
      /heic|heif/i.test(fileType)
        ? `${fileName} is a HEIC photo, which browsers can't read. On iPhone: Settings → Camera → Formats → "Most Compatible", or take a screenshot of the photo and use that instead.`
        : `${fileName} isn't an image format we can read (${fileType || 'unknown type'}). PNG or JPEG works.`
    )
    this.name = 'UnsupportedImageError'
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not decode the image'))
    img.src = src
  })
}

function readAsDataURL(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Could not read the file'))
    reader.readAsDataURL(file)
  })
}

// Downscale to something the API accepts, keeping text legible.
export async function prepareImage(file: File | Blob, fallbackName = 'pasted image'): Promise<PreparedImage> {
  const name = (file as File).name || fallbackName
  const type = file.type || ''

  if (!SUPPORTED_TYPES.includes(type)) {
    // GIF can't be re-encoded meaningfully but the API takes it as-is
    if (!/^image\//.test(type)) throw new UnsupportedImageError(name, type)
    if (/heic|heif/i.test(type)) throw new UnsupportedImageError(name, type)
  }

  const dataUrl = await readAsDataURL(file)

  // Animated GIFs would lose their frames through a canvas; they're already
  // small enough and the API handles them.
  if (type === 'image/gif') {
    return { data: dataUrl.split(',')[1], mimeType: 'image/gif', name }
  }

  let img: HTMLImageElement
  try {
    img = await loadImage(dataUrl)
  } catch {
    throw new UnsupportedImageError(name, type)
  }

  const longEdge = Math.max(img.width, img.height)
  const scale = longEdge > MAX_EDGE ? MAX_EDGE / longEdge : 1

  // Already small enough — don't re-encode and lose sharpness on text.
  if (scale === 1 && dataUrl.length < 4_000_000) {
    return {
      data: dataUrl.split(',')[1],
      mimeType: SUPPORTED_TYPES.includes(type) ? type : 'image/png',
      name,
    }
  }

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.width * scale)
  canvas.height = Math.round(img.height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not process the image in this browser')
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

  const out = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
  return { data: out.split(',')[1], mimeType: 'image/jpeg', name }
}

export async function prepareImages(files: Array<File | Blob>): Promise<{
  images: PreparedImage[]
  errors: string[]
}> {
  const images: PreparedImage[] = []
  const errors: string[] = []

  for (const file of files) {
    try {
      images.push(await prepareImage(file))
    } catch (e: any) {
      // One bad file shouldn't discard the others — a coach picking four
      // screenshots and getting nothing back has no idea which one broke.
      errors.push(e.message || 'Could not read one of the images')
    }
  }
  return { images, errors }
}

// Pull images out of a paste event. Screenshots arrive as files on the
// clipboard; some apps also put an <img> in the HTML flavour, which we ignore
// because it's usually a remote URL we can't fetch.
export function imagesFromClipboard(e: ClipboardEvent | React.ClipboardEvent): File[] {
  const dt = (e as any).clipboardData as DataTransfer | undefined
  if (!dt) return []
  const out: File[] = []
  for (const item of Array.from(dt.items || [])) {
    if (item.kind !== 'file') continue
    const file = item.getAsFile()
    if (file && /^image\//.test(file.type)) out.push(file)
  }
  if (out.length === 0 && dt.files?.length) {
    for (const f of Array.from(dt.files)) {
      if (/^image\//.test(f.type)) out.push(f)
    }
  }
  return out
}
