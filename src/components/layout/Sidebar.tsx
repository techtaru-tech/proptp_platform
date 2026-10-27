import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronDown, ChevronsLeft, ChevronsRight, X } from 'lucide-react';
import { NAV_ITEMS, NAV_SECTIONS, type NavItem } from '../../app/navConfig';
import { usePermissions } from '../../app/usePermissions';
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

function useAutoExpanded(pathname: string) {
  // Longest matching child wins, so /payouts/payroll opens HRMS rather than Payouts.
  let best: { label: string; len: number } | undefined;
  for (const item of NAV_ITEMS) {
    for (const c of item.children ?? []) {
      if ((pathname === c.to || pathname.startsWith(`${c.to}/`)) && (!best || c.to.length > best.len)) best = { label: item.label, len: c.to.length };
    }
  }
  return best?.label ?? NAV_ITEMS.find((item) => pathname.startsWith(item.to))?.label;
}

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar, mobileSidebarOpen, setMobileSidebarOpen } = useUI();
  const { navItems } = usePermissions();
  const location = useLocation();
  const autoExpanded = useAutoExpanded(location.pathname);
  // Sections hold only the items this person may open, and drop out when none are left.
  const sections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.map((label) => navItems.find((i) => i.label === label)).filter((i): i is NavItem => !!i),
  })).filter((section) => section.items.length > 0);
  const autoSection = sections.find((s) => s.items.some((i) => i.label === autoExpanded))?.label;
  const [expandedSection, setExpandedSection] = useState<string | undefined>(undefined);
  const [expandedItem, setExpandedItem] = useState<string>('');
  // Follows the page until the person opens or closes a section themselves.
  const activeSection = expandedSection ?? autoSection;

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

      {!sidebarCollapsed && (
        <div className="px-4 pb-3 pt-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-white/40">Admin Panel</p>
        </div>
      )}

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2.5 pb-4 scrollbar-none">
        {sections.map((section) => {
          const single = section.items.length === 1 ? section.items[0] : undefined;
          const isOpen = activeSection === section.label;
          const isCurrent = autoExpanded !== undefined && section.items.some((i) => i.label === autoExpanded);
          const rowClass = (on: boolean) =>
            cn(
              'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors focus-ring',
              on ? 'bg-white/10 text-white' : 'text-white/70 hover:bg-white/5 hover:text-white',
              sidebarCollapsed && 'justify-center'
            );

          // A section that is just one page (Dashboard, Reports with no children) is a plain link.
          if (single && !single.children) {
            return (
              <NavLink key={section.label} to={single.to} title={sidebarCollapsed ? section.label : undefined} className={rowClass(isCurrent)}>
                <section.icon size={18} className="shrink-0" />
                {!sidebarCollapsed && <span className="truncate">{section.label}</span>}
              </NavLink>
            );
          }

          return (
            <div key={section.label}>
              <button
                type="button"
                onClick={() => setExpandedSection(isOpen ? '' : section.label)}
                className={rowClass(isCurrent || isOpen)}
                title={sidebarCollapsed ? section.label : undefined}
              >
                <section.icon size={18} className="shrink-0" />
                {!sidebarCollapsed && (
                  <>
                    <span className="flex-1 truncate text-left">{section.label}</span>
                    <ChevronDown size={14} className={cn('shrink-0 transition-transform', isOpen && 'rotate-180')} />
                  </>
                )}
              </button>

              {isOpen && !sidebarCollapsed && (
                <div className="mb-1 ml-[1.65rem] mt-0.5 space-y-0.5 border-l border-white/10 pl-3">
                  {single
                    ? single.children!.map((child) => <ChildLink key={child.to} to={child.to} label={child.label} />)
                    : section.items.map((item) =>
                        item.children ? (
                          <div key={item.label}>
                            <button
                              type="button"
                              onClick={() => setExpandedItem(expandedItem === item.label ? '' : item.label)}
                              className={cn(
                                'flex w-full items-center rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors focus-ring',
                                autoExpanded === item.label || expandedItem === item.label ? 'text-white' : 'text-white/60 hover:bg-white/5 hover:text-white'
                              )}
                            >
                              <span className="flex-1 truncate text-left">{item.label}</span>
                              <ChevronDown size={12} className={cn('shrink-0 transition-transform', (autoExpanded === item.label || expandedItem === item.label) && 'rotate-180')} />
                            </button>
                            {(autoExpanded === item.label || expandedItem === item.label) && (
                              <div className="ml-2 space-y-0.5 border-l border-white/10 pl-2">
                                {item.children.map((child) => (
                                  <ChildLink key={child.to} to={child.to} label={child.label} />
                                ))}
                              </div>
                            )}
                          </div>
                        ) : (
                          <ChildLink key={item.to} to={item.to} label={item.label} />
                        )
                      )}
                </div>
              )}
            </div>
          );
        })}
      </nav>

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
