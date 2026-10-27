import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useNavSections } from '../../app/useNavSections';
import { cn } from '../../utils/cn';

/**
 * The panel's sections as tabs under the header. A tab opens the first page of its section, and the
 * sidebar then lists that section's pages — so each section is its own tab, not one long menu.
 */
export function SectionTabs() {
  const { sections, active } = useNavSections();
  const activeRef = useRef<HTMLAnchorElement>(null);

  // Keeps the current tab in view when there are more tabs than the width allows.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active?.label]);

  if (sections.length <= 1) return null;

  return (
    <nav aria-label="Sections" className="sticky top-16 z-10 border-b border-line bg-white">
      <div className="flex gap-0.5 overflow-x-auto px-3 scrollbar-none sm:px-5">
        {sections.map((section) => {
          const isActive = active?.label === section.label;
          return (
            <Link
              key={section.label}
              ref={isActive ? activeRef : undefined}
              to={section.firstPath}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'inline-flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 py-3 text-[13px] font-medium transition-colors focus-ring',
                isActive ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-muted hover:border-line-strong hover:text-ink'
              )}
            >
              <section.icon size={15} className="shrink-0" />
              {section.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
