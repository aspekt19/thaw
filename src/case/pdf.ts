function escapePdf(text: string): string {
  return text.replace(/[^\x20-\x7e]/g, ' ').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

export function wrapLine(text: string, width = 95): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length === 0) return ['']
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (next.length <= width) current = next
    else {
      if (current) lines.push(current)
      current = word.length <= width ? word : word.slice(0, width)
    }
  }
  if (current) lines.push(current)
  return lines
}

/** Timeline plus appeal. Lines wrap, and extra lines start another page. */
export function timelinePdf(lines: string[]): Uint8Array {
  const wrapped = lines.flatMap((line) => wrapLine(line))
  const pages: string[][] = []
  for (let i = 0; i < Math.max(wrapped.length, 1); i += 40) pages.push(wrapped.slice(i, i + 40))
  const objects: string[] = []
  const pageIds: number[] = []
  let id = 3
  const fontId = 2 + pages.length * 2 + 1
  for (const page of pages) {
    const contentId = id
    const pageId = id + 1
    pageIds.push(pageId)
    const body = ['BT', '/F1 11 Tf', '50 740 Td', '14 TL']
    for (const line of page) body.push(`(${escapePdf(line)}) Tj`, 'T*')
    body.push('ET')
    const stream = body.join('\n')
    objects.push(`${contentId} 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj`)
    objects.push(`${pageId} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >> endobj`)
    id += 2
  }
  objects.unshift(`2 0 obj << /Type /Pages /Kids [${pageIds.map((page) => `${page} 0 R`).join(' ')}] /Count ${pages.length} >> endobj`)
  objects.unshift('1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj')
  objects.push(`${fontId} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj`)
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  for (const object of objects) {
    offsets.push(pdf.length)
    pdf += `${object}\n`
  }
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n`
  pdf += '0000000000 65535 f \n'
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return new TextEncoder().encode(pdf)
}
