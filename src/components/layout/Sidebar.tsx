import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronDown, ChevronsLeft, ChevronsRight, X } from 'lucide-react';
import { NAV_ITEMS } from '../../app/navConfig';
import { usePermissions } from '../../app/usePermissions';
import { useUI } from '../../context/UIContext';
import { cn } from '../../utils/cn';
import shreeramLogo from '../../assets/brand/shreeram-logo.png';

function useAutoExpanded(pathname: string) {
  const match = NAV_ITEMS.find((item) => item.children?.some((c) => pathname.startsWith(c.to)) || pathname.startsWith(item.to));
  return match?.label;
}

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar, mobileSidebarOpen, setMobileSidebarOpen } = useUI();
  const { navItems } = usePermissions();
  const location = useLocation();
  const autoExpanded = useAutoExpanded(location.pathname);
  const [expanded, setExpanded] = useState<string | undefined>(autoExpanded);

  const activeGroup = expanded ?? autoExpanded;

  const content = (
    <div className="flex h-full flex-col bg-navy-900 text-white">
      <div className={cn('flex items-center border-b border-white/10 px-4 py-4', sidebarCollapsed ? 'justify-center' : 'justify-between')}>
        {sidebarCollapsed ? (
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold">SR</span>
        ) : (
          <img src={shreeramLogo} alt="Shree Ram Group" className="h-8 w-auto rounded" />
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
        {navItems.map((item) => {
          const isActiveGroup = activeGroup === item.label;
          const hasActiveChild = item.children?.some((c) => location.pathname.startsWith(c.to));
          const isTopActive = !item.children && location.pathname.startsWith(item.to);

          return (
            <div key={item.label}>
              {item.children ? (
                <button
                  type="button"
                  onClick={() => setExpanded(isActiveGroup ? undefined : item.label)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors focus-ring',
                    hasActiveChild || isActiveGroup ? 'bg-white/10 text-white' : 'text-white/70 hover:bg-white/5 hover:text-white',
                    sidebarCollapsed && 'justify-center'
                  )}
                  title={sidebarCollapsed ? item.label : undefined}
                >
                  <item.icon size={18} className="shrink-0" />
                  {!sidebarCollapsed && (
                    <>
                      <span className="flex-1 truncate text-left">{item.label}</span>
                      <ChevronDown size={14} className={cn('shrink-0 transition-transform', isActiveGroup && 'rotate-180')} />
                    </>
                  )}
                </button>
              ) : (
                <NavLink
                  to={item.to}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors focus-ring',
                    isTopActive ? 'bg-brand-600 text-white' : 'text-white/70 hover:bg-white/5 hover:text-white',
                    sidebarCollapsed && 'justify-center'
                  )}
                  title={sidebarCollapsed ? item.label : undefined}
                >
                  <item.icon size={18} className="shrink-0" />
                  {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                </NavLink>
              )}

              {item.children && isActiveGroup && !sidebarCollapsed && (
                <div className="mb-1 ml-[1.65rem] mt-0.5 space-y-0.5 border-l border-white/10 pl-3">
                  {item.children.map((child) => (
                    <NavLink
                      key={child.to}
                      to={child.to}
                      end
                      className={({ isActive }) =>
                        cn(
                          'block rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors focus-ring',
                          isActive ? 'bg-brand-600 text-white' : 'text-white/60 hover:bg-white/5 hover:text-white'
                        )
                      }
                    >
                      {child.label}
                    </NavLink>
                  ))}
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
          <div className="absolute inset-0 bg-navy-950/60" onClick={() => setMobileSidebarOpen(false)} aria-hidden="true" />
          <div className="relative z-10 h-full w-64">{content}</div>
        </div>
      )}
    </>
  );
}
