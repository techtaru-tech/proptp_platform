import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Bookmark, Check, Sparkles, X } from 'lucide-react';
import { cn } from '../../utils/cn';

/* ------------------------------------------------------------------ ask the analyst from anywhere */

/** Opens the analyst with a question. Provided by CRM Overview; a no-op anywhere else. */
export const AskContext = createContext<(question: string) => void>(() => undefined);

/** A small ✦ button on a panel: asks the analyst about exactly that panel. */
export function AskAi({ q }: { q: string }) {
  const ask = useContext(AskContext);
  return (
    <button
      type="button" onClick={() => ask(q)} title={`Ask AI: ${q}`} aria-label={`Ask the AI analyst: ${q}`}
      className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-ink-subtle transition-colors duration-100 hover:bg-brand-50 hover:text-brand-700 focus-ring print:hidden"
    >
      <Sparkles size={12} aria-hidden="true" /> Ask
    </button>
  );
}

/* ------------------------------------------------------------------ jump between sections */

export interface NavSection { id: string; label: string }

/** A sticky row of the page's sections; the one in view is highlighted. */
export function SectionNav({ sections }: { sections: NavSection[] }) {
  const [current, setCurrent] = useState(sections[0]?.id);
  useEffect(() => {
    const seen = new Map<string, boolean>();
    const obs = new IntersectionObserver((entries) => {
      for (const e of entries) seen.set(e.target.id, e.isIntersecting);
      const first = sections.find((s) => seen.get(s.id));
      if (first) setCurrent(first.id);
    }, { rootMargin: '-110px 0px -55% 0px' });
    for (const s of sections) { const el = document.getElementById(s.id); if (el) obs.observe(el); }
    return () => obs.disconnect();
  }, [sections]);

  return (
    <nav aria-label="Sections on this page" className="sticky top-12 z-20 -mx-1 overflow-x-auto rounded-lg border border-line bg-surface px-1 py-1 shadow-[0_6px_12px_-10px_rgba(16,24,40,0.25)] scrollbar-none print:hidden">
      <ul className="flex gap-0.5">
        {sections.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => document.getElementById(s.id)?.scrollIntoView({ block: 'start' })}
              aria-current={current === s.id ? 'true' : undefined}
              className={cn('whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-100 focus-ring', current === s.id ? 'bg-brand-50 text-brand-700' : 'text-ink-subtle hover:bg-surface-muted hover:text-ink')}
            >
              {s.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** An invisible marker the nav scrolls to; it takes no room in the page's spacing. */
export function Anchor({ id }: { id: string }) {
  // No bottom margin of its own, so the page spacing around it stays one gap, not two.
  return <div id={id} className="mb-0 h-0 scroll-mt-28" aria-hidden="true" />;
}

/* ------------------------------------------------------------------ saved views */

interface SavedView { name: string; query: string }
const VIEWS_KEY = 'propto.crmOverview.views';

function readViews(): SavedView[] {
  try { return JSON.parse(localStorage.getItem(VIEWS_KEY) ?? '[]') as SavedView[]; } catch { return []; }
}
function writeViews(views: SavedView[]) {
  try { localStorage.setItem(VIEWS_KEY, JSON.stringify(views)); } catch { /* storage blocked: the view lasts this visit */ }
}

/** Named sets of filters, kept in this browser, applied in one click. */
export function SavedViews({ query, apply }: { query: string; apply: (query: string) => void }) {
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState<SavedView[]>(readViews);
  const [name, setName] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const save = () => {
    const n = name.trim();
    if (!n) return;
    const next = [...views.filter((v) => v.name !== n), { name: n, query }];
    setViews(next); writeViews(next); setName('');
  };
  const remove = (n: string) => { const next = views.filter((v) => v.name !== n); setViews(next); writeViews(next); };
  const currentName = views.find((v) => v.query === query)?.name;

  return (
    <div ref={box} className="relative">
      <button
        type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className={cn('flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors duration-100 focus-ring', currentName ? 'border-brand-600 bg-brand-50 font-medium text-brand-700' : 'border-line text-ink-muted hover:border-line-strong hover:text-ink')}
      >
        <Bookmark size={12} aria-hidden="true" /> {currentName ?? 'Views'}
      </button>
      {open && (
        <div className="absolute left-0 top-9 z-30 w-72 rounded-lg border border-line bg-surface p-2 shadow-popover">
          {views.length === 0 ? <p className="px-1 py-1.5 text-xs text-ink-subtle">No saved views yet. Set the filters you check often, then save them here.</p> : (
            <ul className="mb-2 max-h-56 overflow-y-auto">
              {views.map((v) => (
                <li key={v.name} className="group flex items-center gap-1">
                  <button type="button" onClick={() => { apply(v.query); setOpen(false); }} className="flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] text-ink hover:bg-surface-subtle focus-ring">
                    {v.query === query ? <Check size={12} className="shrink-0 text-brand-600" /> : <span className="w-3 shrink-0" />}
                    <span className="truncate">{v.name}</span>
                  </button>
                  <button type="button" onClick={() => remove(v.name)} aria-label={`Delete view ${v.name}`} className="rounded p-1 text-ink-faint opacity-0 hover:text-danger-600 focus-ring group-hover:opacity-100"><X size={12} /></button>
                </li>
              ))}
            </ul>
          )}
          <form className="flex gap-1.5 border-t border-line pt-2" onSubmit={(e) => { e.preventDefault(); save(); }}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name these filters…" aria-label="View name" className="h-7 min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-2 text-xs text-ink focus-ring" />
            <button type="submit" disabled={!name.trim()} className="h-7 rounded-md bg-brand-600 px-2.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-40 focus-ring">Save</button>
          </form>
        </div>
      )}
    </div>
  );
}
