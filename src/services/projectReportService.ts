import { formatFullCurrency } from '../utils/format';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { api } from './apiClient';
import { BASE_URL, storedAuthToken } from './apiClient';

/** Project & operations reports (server/src/services/projectReports.ts). One definition feeds screen, Excel and PDF. */

export interface ReportTable { title: string; columns: string[]; rows: (string | number)[][]; money?: number[] }
export interface ProjectReport { key: string; title: string; description: string; summary: { label: string; value: string | number }[]; tables: ReportTable[] }
export interface CatalogueEntry { key: string; title: string; description: string; takesProject: boolean }

export const getCatalogue = () => api.get<CatalogueEntry[]>('/ops-reports/suite');
export const getProjectReport = (key: string, projectId?: string) => api.get<ProjectReport>(`/ops-reports/suite/${key}${projectId ? `?projectId=${projectId}` : ''}`);

/** Downloads the server-built workbook. Fetched with the session token, then handed to the browser as a file. */
export async function downloadExcel(key: string, projectId?: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/ops-reports/suite/${key}/export.xlsx${projectId ? `?projectId=${projectId}` : ''}`, {
    headers: { Authorization: `Bearer ${storedAuthToken() ?? ''}` },
  });
  if (!res.ok) throw new Error('Could not build the Excel file.');
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = `${key}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

/** One PDF with every table of the report, from the same data the screen shows. */
export function downloadPdf(report: ProjectReport, projectName?: string): void {
  const doc = new jsPDF({ orientation: 'landscape' });
  doc.setFontSize(15);
  doc.setTextColor(101, 34, 81);
  doc.text(report.title, 14, 16);
  doc.setFontSize(9);
  doc.setTextColor(102, 112, 133);
  doc.text([projectName ? `Project: ${projectName}` : 'All projects', report.summary.map((s) => `${s.label}: ${s.value}`).join('   |   ')].join('   —   '), 14, 22, { maxWidth: 265 });
  let y = 28;
  for (const t of report.tables) {
    doc.setFontSize(11);
    doc.setTextColor(16, 24, 40);
    if (y > 175) { doc.addPage(); y = 16; }
    doc.text(t.title, 14, y);
    if (t.rows.length === 0) {
      doc.setFontSize(9);
      doc.setTextColor(152, 162, 179);
      doc.text('Nothing to show.', 14, y + 6);
      y += 14;
      continue;
    }
    autoTable(doc, {
      head: [t.columns],
      body: t.rows.map((r) => r.map((c, i) => (t.money?.includes(i) && typeof c === 'number' ? formatFullCurrency(c).replace('₹', 'Rs. ') : String(c)))),
      startY: y + 3,
      styles: { fontSize: 7.5, cellPadding: 2 },
      headStyles: { fillColor: [101, 34, 81], textColor: 255 },
      alternateRowStyles: { fillColor: [246, 247, 249] },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
  }
  doc.setFontSize(7.5);
  doc.setTextColor(152, 162, 179);
  doc.text(`Generated ${new Date().toLocaleString('en-IN')}`, 14, doc.internal.pageSize.getHeight() - 8);
  doc.save(`${report.key}.pdf`);
}
