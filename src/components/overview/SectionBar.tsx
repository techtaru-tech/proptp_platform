import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { useSection } from '../../app/useSection';
import { cn } from '../../utils/cn';
import { SectionAssistant } from './SectionAssistant';

/**
 * Above every page of a section (HRMS, Real Estate…): the section's pages as tabs, Overview
 * first, and a button that opens the section's own assistant from wherever you are.
 */
export function SectionBar() {
  const section = useSection();
  const [open, setOpen] = useState(false);
  if (!section) return null;
  const page = section.tabs.find((t) => t.to === section.active)?.label;

  return (
    <div className="-mt-1 mb-4 flex items-center gap-3 border-b border-line print:hidden">
      <nav aria-label={`${section.label} pages`} className="-mb-px flex min-w-0 flex-1 gap-1 overflow-x-auto scrollbar-none">
        {section.tabs.map((t) => {
          const on = t.to === section.active;
          return (
            <NavLink
              key={t.to} to={t.to} end
              className={cn(
                'shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-[13px] transition-colors duration-100 focus-ring',
                on ? 'border-brand-600 font-semibold text-brand-700' : 'border-transparent text-ink-subtle hover:border-line-strong hover:text-ink'
              )}
            >
              {t.label}
            </NavLink>
          );
        })}
      </nav>
      {!section.onOverview && (
        <button
          type="button" onClick={() => setOpen(true)}
          className="mb-1.5 flex shrink-0 items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-1.5 text-xs font-medium text-brand-800 transition-colors duration-100 hover:border-brand-400 hover:bg-brand-100 focus-ring"
        >
          <Sparkles size={13} aria-hidden="true" />
          <span className="hidden sm:inline">Ask {section.label} Assistant</span>
          <span className="sm:hidden">Ask</span>
        </button>
      )}
      {open && <SectionAssistant section={section.key} label={section.label} page={page} onClose={() => setOpen(false)} />}
    </div>
  );
}
