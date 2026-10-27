import { NavLink } from 'react-router-dom';
import { ChevronsLeft, ChevronsRight, X } from 'lucide-react';
import { useNavSections } from '../../app/useNavSections';
import { useUI } from '../../context/UIContext';
import { cn } from '../../utils/cn';
import techtaruLockup from '../../assets/brand/techtaru-lockup.png';
import techtaruMark from '../../assets/brand/techtaru-mark.png';

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

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar, setMobileSidebarOpen, mobileSidebarOpen } = useUI();
  const { sections, active } = useNavSections();

  const content = (
    <div className="flex h-full flex-col bg-shell-900 text-white">
      <div className={cn('flex items-center border-b border-white/10 px-4 py-4', sidebarCollapsed ? 'justify-center' : 'justify-between')}>
        {/* The logo's own plum is close to the sidebar's, and "Developers" is set in near-black,
            so it sits on a white chip rather than directly on the dark surface. */}
        {sidebarCollapsed ? (
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white p-1.5 shadow-card">
            <img src={techtaruMark} alt="TechTaru Digital" className="h-full w-auto" />
          </span>
        ) : (
          <span className="inline-flex rounded-lg bg-white px-2.5 py-1.5 shadow-card">
            <img src={techtaruLockup} alt="TechTaru Digital" className="h-6 w-auto" />
          </span>
        )}
        <button
          type="button"
          onClick={() => setMobileSidebarOpen(false)}
          aria-label="Close navigation"
          className="rounded-md p-1 text-white/70 hover:bg-white/10 hover:text-white md:hidden focus-ring"
        >
          <X size={18} />
        </button>
      </div>

      {!sidebarCollapsed && active && (
        <div className="px-4 pb-3 pt-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-white/40">{active.label}</p>
        </div>
      )}

      {sidebarCollapsed ? (
        // Collapsed: the sections themselves as icons, since the section tabs carry the names.
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2.5 py-4 scrollbar-none">
          {sections.map((section) => (
            <NavLink
              key={section.label}
              to={section.firstPath}
              title={section.label}
              className={cn(
                'flex w-full items-center justify-center rounded-lg px-2.5 py-2 text-sm font-medium transition-colors focus-ring',
                active?.label === section.label ? 'bg-white/10 text-white' : 'text-white/70 hover:bg-white/5 hover:text-white'
              )}
            >
              <section.icon size={18} className="shrink-0" />
            </NavLink>
          ))}
        </nav>
      ) : (
        // Expanded: only the pages of the section whose tab is open.
        <nav className="flex-1 space-y-3 overflow-y-auto px-2.5 pb-4 scrollbar-none">
          {active?.items.map((item) => {
            const single = active.items.length === 1;
            if (!item.children) return <ChildLink key={item.to} to={item.to} label={item.label} />;
            return (
              <div key={item.label} className="space-y-0.5">
                {/* A section holding several items names each group; one holding a single item lists its pages directly. */}
                {!single && <p className="px-2.5 pb-0.5 pt-1 text-[11px] font-semibold uppercase tracking-wider text-white/40">{item.label}</p>}
                {item.children.map((child) => (
                  <ChildLink key={child.to} to={child.to} label={child.label} />
                ))}
              </div>
            );
          })}
        </nav>
      )}

      <div className="hidden border-t border-white/10 p-2.5 md:block">
        <button
          type="button"
          onClick={toggleSidebar}
          className="flex w-full items-center justify-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-white/60 hover:bg-white/5 hover:text-white focus-ring"
        >
          {sidebarCollapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
          {!sidebarCollapsed && 'Collapse'}
        </button>
      </div>
    </div>
  );

  return (
    <>
      <aside className={cn('hidden shrink-0 transition-all duration-200 md:block', sidebarCollapsed ? 'w-[76px]' : 'w-64')}>
        <div className="fixed inset-y-0 z-30 w-[inherit]" style={{ width: sidebarCollapsed ? 76 : 256 }}>
          {content}
        </div>
      </aside>

      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-shell-950/60" onClick={() => setMobileSidebarOpen(false)} aria-hidden="true" />
          <div className="relative z-10 h-full w-64">{content}</div>
        </div>
      )}
    </>
  );
}
