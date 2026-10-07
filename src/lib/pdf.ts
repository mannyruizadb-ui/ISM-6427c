export interface PdfSection {
  title: string
  head: string[]
  body: (string | number)[][]
  foot?: (string | number)[]
  /** Column indexes to right-align (numbers). */
  numeric?: number[]
}

/** Build a landscape PDF report. jsPDF is loaded only when exporting. */
export async function exportPdf(title: string, subtitle: string, sections: PdfSection[], filename: string) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' })
  const green: [number, number, number] = [47, 94, 62]
  const pageW = doc.internal.pageSize.getWidth()

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.setTextColor(...green)
  doc.text(title, 40, 48)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(90)
  doc.text(subtitle, 40, 66)
  doc.text(`Generated ${new Date().toLocaleString('en-US')}`, pageW - 40, 66, { align: 'right' })

  let y = 86
  for (const s of sections) {
    if (y > doc.internal.pageSize.getHeight() - 120) {
      doc.addPage()
      y = 48
    }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.setTextColor(30)
    doc.text(s.title, 40, y)
    const styles: Record<number, { halign: 'right' }> = {}
    for (const i of s.numeric ?? []) styles[i] = { halign: 'right' }
    autoTable(doc, {
      startY: y + 8,
      head: [s.head],
      body: s.body.length ? s.body : [[{ content: 'No data for this period', colSpan: s.head.length }] as any],
      foot: s.foot ? [s.foot] : undefined,
      theme: 'grid',
      styles: { fontSize: 8.5, cellPadding: 4 },
      headStyles: { fillColor: green, textColor: 255 },
      footStyles: { fillColor: [239, 230, 210], textColor: 30, fontStyle: 'bold' },
      columnStyles: styles,
      margin: { left: 40, right: 40 },
    })
    y = (doc as any).lastAutoTable.finalY + 32
  }

  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setTextColor(120)
    doc.text(`Page ${i} of ${pages}`, pageW - 40, doc.internal.pageSize.getHeight() - 20, { align: 'right' })
  }
  doc.save(filename)
}
