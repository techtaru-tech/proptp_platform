import { Link, NavLink } from 'react-router-dom';
import { ChevronsLeft, ChevronsRight, X } from 'lucide-react';
import { useNavSections } from '../../app/useNavSections';
import { useUI } from '../../context/UIContext';
import { cn } from '../../utils/cn';
import techtaruLockup from '../../assets/brand/techtaru-lockup.png';
import techtaruMark from '../../assets/brand/techtaru-mark.png';

const RAIL_WIDTH = 76;
const PANEL_WIDTH = 208;

function ChildLink({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        cn(
          'block rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors focus-ring',
          isActive ? 'bg-brand-600 text-white' : 'text-white/60 hover:bg-white/5 hover:text-white'
        )
      }
    >
      {label}
    </NavLink>
  );
}

/**
 * The sidebar is two columns: the sections as tabs down the left edge, and the open tab's pages
 * beside them. A tab opens its section's first page; the page decides which tab is active, so a
 * direct link lands on the right one. Collapsing hides the pages and keeps the tabs.
 */
export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar, setMobileSidebarOpen, mobileSidebarOpen } = useUI();
  const { sections, active } = useNavSections();

  const content = (
    <div className="flex h-full bg-shell-900 text-white">
      {/* Tabs */}
      <div className="flex shrink-0 flex-col border-r border-white/10 bg-shell-950" style={{ width: RAIL_WIDTH }}>
        <div className="flex items-center justify-center border-b border-white/10 py-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white p-1.5 shadow-card">
            <img src={techtaruMark} alt="TechTaru Digital" className="h-full w-auto" />
          </span>
        </div>
        <nav aria-label="Sections" className="flex-1 space-y-0.5 overflow-y-auto px-1.5 py-2 scrollbar-none">
          {sections.map((section) => {
            const isActive = active?.label === section.label;
            return (
              <Link
                key={section.label}
                to={section.firstPath}
                aria-current={isActive ? 'page' : undefined}
                title={section.label}
                className={cn(
                  'flex w-full flex-col items-center gap-1 rounded-lg px-1 py-2 text-center text-[10px] font-medium leading-tight transition-colors focus-ring',
                  isActive ? 'bg-brand-600 text-white' : 'text-white/65 hover:bg-white/5 hover:text-white'
                )}
              >
                <section.icon size={19} className="shrink-0" />
                <span className="break-words">{section.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="hidden border-t border-white/10 p-1.5 md:block">
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label={sidebarCollapsed ? 'Show the pages of this tab' : 'Hide the pages of this tab'}
            title={sidebarCollapsed ? 'Expand' : 'Collapse'}
            className="flex w-full items-center justify-center rounded-lg py-2 text-white/60 hover:bg-white/5 hover:text-white focus-ring"
          >
            {sidebarCollapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
          </button>
        </div>
      </div>

      {/* The open tab's pages */}
      {!sidebarCollapsed && (
        <div className="flex min-w-0 flex-1 flex-col" style={{ width: PANEL_WIDTH }}>
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-[1.15rem]">
            <span className="inline-flex rounded-lg bg-white px-2.5 py-1.5 shadow-card">
              <img src={techtaruLockup} alt="TechTaru Digital" className="h-5 w-auto" />
            </span>
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(false)}
              aria-label="Close navigation"
              className="rounded-md p-1 text-white/70 hover:bg-white/10 hover:text-white md:hidden focus-ring"
            >
              <X size={18} />
            </button>
          </div>

          {active && (
            <div className="px-4 pb-2 pt-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-white/40">{active.label}</p>
            </div>
          )}

          <nav className="flex-1 space-y-3 overflow-y-auto px-2.5 pb-4 scrollbar-none">
            {active?.items.map((item) => {
              const single = active.items.length === 1;
              if (!item.children) return <ChildLink key={item.to} to={item.to} label={item.label} />;
              return (
                <div key={item.label} className="space-y-0.5">
                  {/* A tab holding several items names each group; one holding a single item lists its pages directly. */}
                  {!single && <p className="px-2.5 pb-0.5 pt-1 text-[11px] font-semibold uppercase tracking-wider text-white/40">{item.label}</p>}
                  {item.children.map((child) => (
                    <ChildLink key={child.to} to={child.to} label={child.label} />
                  ))}
                </div>
              );
            })}
          </nav>
        </div>
      )}
    </div>
  );

  const width = sidebarCollapsed ? RAIL_WIDTH : RAIL_WIDTH + PANEL_WIDTH;

  return (
    <>
      <aside className="hidden shrink-0 transition-all duration-200 md:block" style={{ width }}>
        <div className="fixed inset-y-0 z-30" style={{ width }}>
          {content}
        </div>
      </aside>

      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-shell-950/60" onClick={() => setMobileSidebarOpen(false)} aria-hidden="true" />
          <div className="relative z-10 h-full" style={{ width: RAIL_WIDTH + PANEL_WIDTH }}>
            {content}
          </div>
        </div>
      )}
    </>
  );
}
