import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

const LINK = /^\[([^\]]+)\]\((\/[^)\s]*)\)$/;

/**
 * Inline: **bold**, `code` and links into the panel ([Ravi Shah](/crm/leads/abc)). Only paths that
 * start with "/" become links — an outside URL stays plain text — and nothing is ever injected as HTML.
 */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(\/[^)\s]*\))/g).filter(Boolean).map((part, i) => {
    const link = LINK.exec(part);
    if (link) return <Link key={i} to={link[2]} className="font-medium text-brand-700 underline decoration-brand-300 underline-offset-2 hover:decoration-brand-700">{link[1]}</Link>;
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i} className="font-semibold text-ink">{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={i} className="rounded bg-surface-muted px-1 py-0.5 text-[0.85em]">{part.slice(1, -1)}</code>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
const isRule = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

/** A small reader for what the assistant writes: paragraphs, bullet and numbered lists, tables. */
export function RichText({ text }: { text: string }) {
  const lines = text.replace(/\r/g, '').split('\n');
  const nodes: ReactNode[] = [];
  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }
    const heading = /^\s*#{1,4}\s+(.*)$/.exec(line);
    if (heading) {
      nodes.push(<p key={nodes.length} className="mb-1 mt-3 text-[13px] font-semibold text-ink first:mt-0">{inline(heading[1])}</p>);
      i += 1;
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && isRule(lines[i + 1])) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) { rows.push(cells(lines[i])); i += 1; }
      nodes.push(
        <div key={nodes.length} className="my-2 overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-left text-xs">
            <thead className="bg-surface-subtle text-ink-muted"><tr>{head.map((h, j) => <th key={j} className="px-3 py-1.5 font-medium">{inline(h)}</th>)}</tr></thead>
            <tbody>{rows.map((r, j) => <tr key={j} className="border-t border-line">{r.map((c, k) => <td key={k} className="px-3 py-1.5">{inline(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    const bullet = /^\s*[-*•]\s+/;
    const numbered = /^\s*\d+[.)]\s+/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line);
      const items: string[] = [];
      while (i < lines.length && (ordered ? numbered : bullet).test(lines[i])) { items.push(lines[i].replace(ordered ? numbered : bullet, '')); i += 1; }
      const Tag = ordered ? 'ol' : 'ul';
      nodes.push(<Tag key={nodes.length} className={`my-1.5 space-y-0.5 pl-5 ${ordered ? 'list-decimal' : 'list-disc'}`}>{items.map((t, j) => <li key={j}>{inline(t)}</li>)}</Tag>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^\s*#{1,4}\s+/.test(lines[i]) && !bullet.test(lines[i]) && !numbered.test(lines[i]) && !(lines[i].includes('|') && i + 1 < lines.length && isRule(lines[i + 1]))) { para.push(lines[i]); i += 1; }
    nodes.push(<p key={nodes.length} className="my-1.5 first:mt-0 last:mb-0">{inline(para.join(' '))}</p>);
  }
  return <>{nodes}</>;
}
