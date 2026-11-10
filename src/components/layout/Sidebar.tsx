import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronDown, ChevronsLeft, ChevronsRight, X } from 'lucide-react';
import { NAV_ITEMS, NAV_SECTIONS, type NavItem } from '../../app/navConfig';
import { usePermissions } from '../../app/usePermissions';
import { useUI } from '../../context/UIContext';
import { cn } from '../../utils/cn';
import proptoLockupWhite from '../../assets/brand/propto-lockup-white.png';
import proptoMark from '../../assets/brand/propto-mark.png';

function ChildLink({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        cn(
          'relative block rounded-md px-2.5 py-1 text-[12.5px] transition-colors duration-150 focus-ring',
          isActive ? 'bg-white/[0.08] font-medium text-white before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-brand-400' : 'text-white/60 hover:bg-white/5 hover:text-white'
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
  const { navItems, can } = usePermissions();
  const location = useLocation();
  const autoExpanded = useAutoExpanded(location.pathname);
  // Sections hold only the items this person may open, and drop out when none are left.
  const sections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.map((label) => navItems.find((i) => i.label === label)).filter((i): i is NavItem => !!i),
    overviewTo: section.overview?.modules.some(can) ? section.overview.to : undefined,
  })).filter((section) => section.items.length > 0);
  const onOverview = sections.find((s) => s.overviewTo === location.pathname)?.label;
  const autoSection = onOverview ?? sections.find((s) => s.items.some((i) => i.label === autoExpanded))?.label;
  const [expandedSection, setExpandedSection] = useState<string | undefined>(undefined);
  const [expandedItem, setExpandedItem] = useState<string>('');
  // Follows the page until the person opens or closes a section themselves.
  const activeSection = expandedSection ?? autoSection;

  const content = (
    <div className="flex h-full flex-col bg-shell-900 text-white">
      <div className={cn('flex h-12 shrink-0 items-center border-b border-white/10 px-4', sidebarCollapsed ? 'justify-center' : 'justify-between')}>
        {/* The sidebar is Propto's own navy, so the white-text lockup sits on it directly — the
            way proptocrm.com shows it on dark. The mark alone keeps a white chip: its navy road
            would vanish into the sidebar. */}
        {sidebarCollapsed ? (
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white p-1.5">
            <img src={proptoMark} alt="Propto CRM" className="h-full w-auto" />
          </span>
        ) : (
          <img src={proptoLockupWhite} alt="Propto CRM" className="h-7 w-auto" />
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
        <div className="px-4 pb-1.5 pt-3.5">
          <p className="text-2xs font-semibold uppercase tracking-wider text-white/40">Admin panel</p>
        </div>
      )}

      <nav className="flex-1 space-y-px overflow-y-auto px-2 pb-4 scrollbar-none">
        {sections.map((section) => {
          const single = section.items.length === 1 ? section.items[0] : undefined;
          const isOpen = activeSection === section.label;
          const isCurrent = onOverview === section.label || (!onOverview && autoExpanded !== undefined && section.items.some((i) => i.label === autoExpanded));
          const rowClass = (on: boolean) =>
            cn(
              'relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors duration-150 focus-ring',
              on ? 'bg-white/[0.08] text-white' : 'text-white/70 hover:bg-white/5 hover:text-white',
              sidebarCollapsed && 'justify-center'
            );

          // A section that is just one page (Dashboard, Reports with no children) is a plain link.
          if (single && !single.children && !section.overviewTo) {
            return (
              <NavLink
                key={section.label}
                to={single.to}
                title={sidebarCollapsed ? section.label : undefined}
                className={cn(rowClass(isCurrent), isCurrent && 'before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-brand-400')}
              >
                <section.icon size={16} strokeWidth={1.75} className="shrink-0" />
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
                <section.icon size={16} strokeWidth={1.75} className="shrink-0" />
                {!sidebarCollapsed && (
                  <>
                    <span className="flex-1 truncate text-left">{section.label}</span>
                    <ChevronDown size={14} className={cn('shrink-0 transition-transform', isOpen && 'rotate-180')} />
                  </>
                )}
              </button>

              {isOpen && !sidebarCollapsed && (
                <div className="mb-1 ml-[1.45rem] mt-px space-y-px border-l border-white/10 pl-2.5">
                  {section.overviewTo && <ChildLink to={section.overviewTo} label="Overview" />}
                  {single
                    ? (single.children ?? [single]).map((child) => <ChildLink key={child.to} to={child.to} label={child.label} />)
                    : section.items.map((item) =>
                        item.children ? (
                          <div key={item.label}>
                            <button
                              type="button"
                              onClick={() => setExpandedItem(expandedItem === item.label ? '' : item.label)}
                              className={cn(
                                'flex w-full items-center rounded-md px-2.5 py-1 text-[12.5px] font-medium transition-colors duration-150 focus-ring',
                                autoExpanded === item.label || expandedItem === item.label ? 'text-white' : 'text-white/60 hover:bg-white/5 hover:text-white'
                              )}
                            >
                              <span className="flex-1 truncate text-left">{item.label}</span>
                              <ChevronDown size={12} className={cn('shrink-0 transition-transform', (autoExpanded === item.label || expandedItem === item.label) && 'rotate-180')} />
                            </button>
                            {(autoExpanded === item.label || expandedItem === item.label) && (
                              <div className="ml-2 space-y-px border-l border-white/10 pl-2">
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
          className="flex w-full items-center justify-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium text-white/60 hover:bg-white/5 hover:text-white focus-ring"
        >
          {sidebarCollapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
          {!sidebarCollapsed && 'Collapse'}
        </button>
      </div>
    </div>
  );

  return (
    <>
      <aside className={cn('hidden shrink-0 print:!hidden transition-[width] duration-200 md:block', sidebarCollapsed ? 'w-16' : 'w-[232px]')}>
        <div className="fixed inset-y-0 z-30 w-[inherit]" style={{ width: sidebarCollapsed ? 64 : 232 }}>
          {content}
        </div>
      </aside>

      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-shell-950/60" onClick={() => setMobileSidebarOpen(false)} aria-hidden="true" />
          <div className="relative z-10 h-full w-[232px]">{content}</div>
        </div>
      )}
    </>
  );
}
