// The report, as a document.
//
// WHY pdf-lib AND NOT A HEADLESS BROWSER
//
// The obvious way to make a good-looking PDF is to render HTML in Chromium and
// print it. On Vercel that means a ~50MB puppeteer/chromium layer, a function
// that cold-starts in seconds, and a class of failure that only happens in
// production. The document here is a page or two of headed text with a handful
// of links — it does not need a browser, and a coach standing in a car park
// waiting for one is a bad trade.
//
// pdf-lib is pure JavaScript, has no native dependencies, and runs identically
// on a laptop and on a Vercel Node function. It draws primitives, so every
// line of layout below is explicit. That is more code than a stylesheet, and
// it is code that cannot behave differently in the deployed environment.
//
// WHY NOT window.print()
//
// The practice sheet does exactly that and is right to: it is a clipboard, and
// it is for the coach. This is not. It goes to a family, it has the coach's
// name on it, and a browser printout with a URL and a timestamp in the margin
// reads as a screenshot of software rather than as something a coach wrote.
//
// LINKS
//
// Real PDF link annotations, not blue text. "Watch drill" is clickable in
// every viewer that supports annotations, and the raw YouTube URL never
// appears on the page — a 60-character link printed across a paragraph is how
// a document stops looking like a document.

import { PDFDocument, StandardFonts, rgb, PDFString, PDFName, PDFArray } from 'pdf-lib'
import {
  renderSections, contextLine, formatReportDate, reportTypeLabel, brandingFor,
  type FullReport,
} from './playerReports'

// ---------------------------------------------------------------------------
// Page geometry
// ---------------------------------------------------------------------------

const PAGE_W = 612          // US Letter, 72dpi
const PAGE_H = 792
const MARGIN = 56
const CONTENT_W = PAGE_W - MARGIN * 2
const BOTTOM = 76           // where the footer starts

// BenchCoach red, matching the app's primary (tailwind red-600).
const BRAND = rgb(0.86, 0.15, 0.15)
const INK = rgb(0.10, 0.11, 0.13)
const MUTED = rgb(0.42, 0.45, 0.50)
const HAIRLINE = rgb(0.87, 0.88, 0.90)

// ---------------------------------------------------------------------------
// Text safety
// ---------------------------------------------------------------------------

/**
 * The standard PDF fonts encode WinAnsi, and pdf-lib THROWS on a character
 * outside it. A coach pasting a note with an emoji, a curly apostrophe from
 * Word, or a Japanese character in a player's name would otherwise not get a
 * "that didn't work" — they would get a 500 at the last step of an hour's
 * work.
 *
 * So: fold the typography a word processor inserts down to its ASCII
 * equivalent, keep Latin-1 (which WinAnsi covers, so accented names survive),
 * and drop anything else rather than failing.
 */
const FOLD: Record<string, string> = {
  '‘': "'", '’': "'", '‚': ',', '‛': "'",
  '“': '"', '”': '"', '„': '"',
  '–': '-', '—': '-', '−': '-', '‐': '-', '‑': '-',
  '…': '...', '•': '-', '·': '-',
  ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ',
  '′': "'", '″': '"', '­': '',
}

export function pdfSafe(text: string): string {
  let out = ''
  for (const ch of String(text ?? '')) {
    if (ch in FOLD) { out += FOLD[ch]; continue }
    const c = ch.codePointAt(0)!
    if (c === 10) { out += '\n'; continue }
    if (c === 9) { out += '  '; continue }
    if (c >= 0x20 && c <= 0x7e) { out += ch; continue }
    // Latin-1 supplement is fully representable in WinAnsi, so accented names
    // print correctly rather than being mangled.
    if (c >= 0xa0 && c <= 0xff) { out += ch; continue }
    // Everything else — emoji, CJK, symbols we have no glyph for. Dropping is
    // better than a mid-generation exception, and better than a black box.
  }
  return out
}

// ---------------------------------------------------------------------------
// The writer
// ---------------------------------------------------------------------------

interface Fonts { regular: any; bold: any; italic: any }

/**
 * A cursor that knows where it is on the page and adds a new one when it runs
 * out of room. Every draw call goes through it, so nothing can be written into
 * the footer or off the bottom of a page.
 */
class Writer {
  doc: PDFDocument
  fonts: Fonts
  page: any
  y: number
  pages: any[] = []

  constructor(doc: PDFDocument, fonts: Fonts) {
    this.doc = doc
    this.fonts = fonts
    this.page = this.addPage()
    this.y = PAGE_H - MARGIN
  }

  addPage() {
    const p = this.doc.addPage([PAGE_W, PAGE_H])
    this.pages.push(p)
    this.page = p
    this.y = PAGE_H - MARGIN
    return p
  }

  /** Make sure `height` points are available, starting a page if not. */
  need(height: number) {
    if (this.y - height < BOTTOM) this.addPage()
  }

  space(h: number) { this.y -= h }

  /** Split text to fit a width, honouring the newlines the coach typed. */
  wrap(text: string, font: any, size: number, width: number): string[] {
    const lines: string[] = []
    for (const paragraph of pdfSafe(text).split('\n')) {
      if (!paragraph.trim()) { lines.push(''); continue }
      let line = ''
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        const candidate = line ? `${line} ${word}` : word
        if (font.widthOfTextAtSize(candidate, size) <= width) { line = candidate; continue }
        if (line) lines.push(line)
        // A single word longer than the column — a pasted URL, usually. Break
        // it rather than letting it run off the page.
        if (font.widthOfTextAtSize(word, size) > width) {
          let chunk = ''
          for (const ch of word) {
            if (font.widthOfTextAtSize(chunk + ch, size) > width) { lines.push(chunk); chunk = ch }
            else chunk += ch
          }
          line = chunk
        } else {
          line = word
        }
      }
      if (line) lines.push(line)
    }
    // A trailing blank line is a gap nobody asked for.
    while (lines.length && lines[lines.length - 1] === '') lines.pop()
    return lines
  }

  text(
    value: string,
    opts: {
      font?: any; size?: number; color?: any; x?: number
      width?: number; leading?: number; gap?: number
    } = {}
  ) {
    const font = opts.font || this.fonts.regular
    const size = opts.size ?? 10.5
    const x = opts.x ?? MARGIN
    const width = opts.width ?? CONTENT_W
    const leading = opts.leading ?? size * 1.45

    for (const line of this.wrap(value, font, size, width)) {
      this.need(leading)
      if (line) {
        this.page.drawText(line, {
          x, y: this.y - size, size, font, color: opts.color || INK,
        })
      }
      this.y -= leading
    }
    if (opts.gap) this.space(opts.gap)
  }

  rule(color = HAIRLINE) {
    this.need(12)
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE_W - MARGIN, y: this.y },
      thickness: 0.75,
      color,
    })
    this.y -= 12
  }

  /**
   * A clickable region over text already drawn.
   *
   * pdf-lib has no link helper, so the annotation is built by hand and pushed
   * onto the page's /Annots. Border [0,0,0] because a viewer-drawn box around
   * the link would put a rectangle in the middle of the document.
   */
  link(url: string, x: number, y: number, w: number, h: number) {
    const annot = this.doc.context.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: [x, y, x + w, y + h],
      Border: [0, 0, 0],
      A: { Type: 'Action', S: 'URI', URI: PDFString.of(url) },
    })
    const ref = this.doc.context.register(annot)
    const existing = this.page.node.get(PDFName.of('Annots'))
    if (existing instanceof PDFArray) existing.push(ref)
    else this.page.node.set(PDFName.of('Annots'), this.doc.context.obj([ref]))
  }

  /** "Watch drill", underlined, clickable. */
  linkLine(label: string, url: string, indent = 0) {
    const size = 10
    const font = this.fonts.bold
    const safe = pdfSafe(label)
    const w = font.widthOfTextAtSize(safe, size)
    const x = MARGIN + indent
    this.need(size * 1.6)
    const baseline = this.y - size
    this.page.drawText(safe, { x, y: baseline, size, font, color: BRAND })
    this.page.drawLine({
      start: { x, y: baseline - 1.6 }, end: { x: x + w, y: baseline - 1.6 },
      thickness: 0.6, color: BRAND,
    })
    // A little padding round the hit area — a 10pt line is a small target on a
    // phone, and the annotation costs nothing to make generous.
    this.link(url, x - 2, baseline - 4, w + 4, size + 7)
    this.y -= size * 1.6
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * A finalized report as PDF bytes.
 *
 * Deterministic: everything it draws comes from the report row and its
 * snapshots, all of which are frozen at finalization. Regenerating a report
 * from 2026 in 2027 produces the same document, which is why finalized PDFs
 * are not stored anywhere — there is nothing a stored copy would preserve that
 * the data does not.
 */
export async function renderReportPdf(report: FullReport): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
  }

  const ctx = report.context
  const playerName = ctx?.player_name || 'Player'
  const title = `${reportTypeLabel(report.report_type)} — ${playerName}`

  doc.setTitle(title)
  doc.setSubject('Player development report')
  // Creator, not Producer: pdf-lib stamps its own Producer on save, so setting
  // that one looks like it works and silently does not.
  doc.setCreator('BenchCoach')

  const w = new Writer(doc, fonts)

  // ---- Masthead ----------------------------------------------------------
  // Wordmark rather than a logo image: an embedded PNG is another thing that
  // can be missing at runtime, and this is a coach's letterhead, not an advert.
  // The coach's letterhead, or ours when they have not set one. Both slots
  // are the coach's text, so both go through pdfSafe like everything else.
  const brand = brandingFor(ctx)
  const wordmark = pdfSafe(brand.brand_name).toUpperCase()
  const kicker = pdfSafe(brand.header_line).toUpperCase()
  const wordmarkW = fonts.bold.widthOfTextAtSize(wordmark, 9)
  const kickerW = fonts.regular.widthOfTextAtSize(kicker, 8)

  w.page.drawText(wordmark, {
    x: MARGIN, y: PAGE_H - MARGIN + 2, size: 9,
    font: fonts.bold, color: BRAND,
  })
  if (wordmarkW + kickerW + 16 <= CONTENT_W) {
    w.page.drawText(kicker, {
      x: PAGE_W - MARGIN - kickerW, y: PAGE_H - MARGIN + 2,
      size: 8, font: fonts.regular, color: MUTED,
    })
    w.space(14)
  } else {
    // A long league name and the kicker will not share a line. The kicker
    // drops underneath rather than colliding with it.
    w.page.drawText(kicker, {
      x: MARGIN, y: PAGE_H - MARGIN + 2 - 12,
      size: 8, font: fonts.regular, color: MUTED,
    })
    w.space(26)
  }
  w.rule(BRAND)
  w.space(10)

  // ---- Who and when ------------------------------------------------------
  w.text(playerName, { font: fonts.bold, size: 24, leading: 28 })

  const line = contextLine(ctx)
  if (line) w.text(line, { color: MUTED, size: 11, leading: 15 })

  const meta = [
    reportTypeLabel(report.report_type),
    formatReportDate(report.report_date),
    ctx?.coach_name ? `Coach ${ctx.coach_name}` : null,
    report.revision > 1 ? `Revision ${report.revision}` : null,
    // A coach can preview the PDF before finalizing, which is the only way to
    // judge whether it is ready. Marking it means a preview that gets emailed
    // by accident announces itself rather than passing as the finished thing.
    report.status === 'draft' ? 'DRAFT — not finalized' : null,
  ].filter(Boolean).join('  ·  ')
  if (meta) w.text(meta, { color: MUTED, size: 9.5, leading: 14 })

  w.space(8)
  w.rule()
  w.space(6)

  // ---- Sections ----------------------------------------------------------
  // renderSections() has already dropped everything empty, so there is no
  // "if it has content" test anywhere below — a heading printed here always
  // has something under it.
  for (const section of renderSections(report)) {
    // Keep a heading with at least a couple of lines of what follows it. A
    // heading alone at the foot of a page reads as a section that lost its
    // contents.
    w.need(64)
    w.space(10)
    w.text(section.heading.toUpperCase(), {
      font: fonts.bold, size: 10, color: BRAND, leading: 16,
    })
    w.space(2)

    if (section.body) w.text(section.body, { size: 10.5, leading: 15.5, gap: 4 })

    if (section.priorities) {
      section.priorities.forEach((p, i) => {
        w.need(40)
        w.space(6)
        w.text(`${i + 1}. ${p.label}`, { font: fonts.bold, size: 11.5, leading: 16 })
        if (p.body) w.text(p.body, { size: 10.5, leading: 15.5, x: MARGIN + 16, width: CONTENT_W - 16 })
      })
      w.space(4)
    }

    if (section.drills) {
      for (const d of section.drills) {
        w.need(56)
        w.space(8)
        w.text(d.name, { font: fonts.bold, size: 11.5, leading: 16 })

        if (d.reason) {
          w.text(`Why this one: ${d.reason}`, {
            font: fonts.italic, size: 9.5, color: MUTED, leading: 13,
            x: MARGIN + 16, width: CONTENT_W - 16,
          })
        }
        if (d.description) {
          w.text(d.description, {
            size: 10, leading: 14.5, x: MARGIN + 16, width: CONTENT_W - 16,
          })
        }
        if (d.dosage) {
          w.text(d.dosage, {
            size: 9.5, color: MUTED, leading: 13.5,
            x: MARGIN + 16, width: CONTENT_W - 16,
          })
        }
        if (d.link) {
          w.space(2)
          w.linkLine(d.link.label, d.link.url, 16)
        }
      }
      w.space(4)
    }
  }

  // ---- Footer ------------------------------------------------------------
  // Drawn last, on every page, once the page count is known.
  const total = w.pages.length
  w.pages.forEach((page, i) => {
    page.drawLine({
      start: { x: MARGIN, y: BOTTOM - 14 }, end: { x: PAGE_W - MARGIN, y: BOTTOM - 14 },
      thickness: 0.5, color: HAIRLINE,
    })
    const left = pdfSafe(
      `${playerName} · ${reportTypeLabel(report.report_type)} · ${formatReportDate(report.report_date)}`
    )
    page.drawText(left, {
      x: MARGIN, y: BOTTOM - 27, size: 7.5, font: fonts.regular, color: MUTED,
    })
    const footer = pdfSafe(brand.footer_text)
    const right = total > 1 ? `${footer}  ·  ${i + 1} of ${total}` : footer
    const rightW = fonts.regular.widthOfTextAtSize(right, 7.5)
    const leftW = fonts.regular.widthOfTextAtSize(left, 7.5)
    // A long footer goes on its own line under the left text rather than
    // running into it. The bottom margin has room for two lines.
    const shareLine = leftW + rightW + 12 <= CONTENT_W
    page.drawText(right, {
      x: shareLine ? PAGE_W - MARGIN - rightW : MARGIN,
      y: shareLine ? BOTTOM - 27 : BOTTOM - 38,
      size: 7.5, font: fonts.regular, color: MUTED,
    })
  })

  return doc.save()
}

/**
 * What the browser should call the download.
 *
 * The player's name is in it because a parent with two kids on two teams ends
 * up with two files in Downloads, and "report.pdf (1)" helps nobody.
 */
export function reportFilename(report: FullReport): string {
  const name = (report.context?.player_name || 'player')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'player'
  const date = (report.report_date || '').slice(0, 10) || 'report'
  return `${name}-development-report-${date}.pdf`
}
