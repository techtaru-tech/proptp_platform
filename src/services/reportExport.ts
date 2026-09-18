import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export interface PdfExportOptions {
  filename: string;
  title: string;
  subtitle?: string;
  columns: string[];
  rows: (string | number)[][];
}

/** Every Report Center page's "Export PDF" button goes through this — one consistent look. */
export function exportReportPdf({ filename, title, subtitle, columns, rows }: PdfExportOptions) {
  const doc = new jsPDF();

  doc.setFontSize(14);
  doc.setTextColor(16, 24, 40);
  doc.text(title, 14, 17);

  let tableStartY = 22;
  if (subtitle) {
    doc.setFontSize(9);
    doc.setTextColor(102, 112, 133);
    doc.text(subtitle, 14, 23);
    tableStartY = 28;
  }

  if (rows.length === 0) {
    doc.setFontSize(10);
    doc.setTextColor(152, 162, 179);
    doc.text('No data for the selected filters.', 14, tableStartY + 6);
  } else {
    autoTable(doc, {
      head: [columns],
      body: rows,
      startY: tableStartY,
      styles: { fontSize: 8, cellPadding: 2.5 },
      headStyles: { fillColor: [12, 34, 57], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [246, 247, 249] },
    });
  }

  doc.setFontSize(7.5);
  doc.setTextColor(152, 162, 179);
  doc.text(`Generated ${new Date().toLocaleString('en-IN')}`, 14, doc.internal.pageSize.getHeight() - 8);

  doc.save(filename);
}
