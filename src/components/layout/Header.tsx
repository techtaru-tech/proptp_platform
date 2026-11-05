import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Menu,
  Search,
  Bell,
  ChevronDown,
  Plus,
  ClipboardList,
  Users,
  Fingerprint,
  BarChart3,
  User,
  ShieldCheck,
  LogOut,
  Moon,
  Sun,
} from 'lucide-react';
import { useUI } from '../../context/UIContext';
import { useAuth } from '../../context/AuthContext';
import { Avatar } from '../ui/Avatar';
import { resolveBreadcrumb } from '../../app/breadcrumbs';
import { refProjects, refUsers } from '../../data/referenceData';
import { listBookings } from '../../services/bookingService';
import { listNotifications } from '../../services/notificationService';
import type { AppNotification, BookingRow } from '../../types';
import { formatRelativeTime } from '../../utils/format';
import { cn } from '../../utils/cn';
import { useTheme } from '../../hooks/useTheme';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

const QUICK_ACTIONS = [
  { label: 'Add Property', to: '/projects/new', icon: Plus },
  { label: 'View Bookings', to: '/bookings', icon: ClipboardList },
  { label: 'Users', to: '/channel-partners', icon: Users },
  { label: 'Attendance', to: '/attendance/today', icon: Fingerprint },
  { label: 'Reports', to: '/reports', icon: BarChart3 },
];

function useClickOutside(onOutside: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onOutside]);
  return ref;
}

interface SearchHit {
  label: string;
  sub: string;
  to: string;
}

/**
 * Projects and partners are matched against the reference-data cache, which is small and
 * already in memory. Bookings are not cached (there can be thousands), so they are searched
 * server-side and merged in — see `useBookingHits` below.
 */
function searchCached(query: string): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const results: SearchHit[] = [];
  refProjects
    .filter((p) => p.projectName.toLowerCase().includes(q) || p.projectLocation.toLowerCase().includes(q))
    .slice(0, 4)
    .forEach((p) => results.push({ label: p.projectName, sub: `Project · ${p.projectLocation}`, to: `/projects/${p.id}` }));
  refUsers
    .filter((u) => u.name.toLowerCase().includes(q) || u.phone.includes(q))
    .slice(0, 4)
    .forEach((u) => results.push({ label: u.name, sub: `Partner · ${u.phone}`, to: `/users/${u.id}` }));
  return results;
}

const SEARCH_DEBOUNCE_MS = 250;

/** Debounced server-side booking search, so typing does not fire a request per keystroke. */
function useBookingHits(query: string): SearchHit[] {
  const [hits, setHits] = useState<SearchHit[]>([]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      listBookings({ search: q, pageSize: 4 })
        .then((page) => {
          if (cancelled) return;
          setHits(
            page.items.map((b: BookingRow) => ({
              label: `${b.bookingName} — ${b.reference}`,
              sub: `Booking · ${b.projectName}`,
              to: `/bookings/${b.id}`,
            }))
          );
        })
        // A failed search should just show no booking hits, not break the header.
        .catch(() => !cancelled && setHits([]));
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  return hits;
}

export function Header() {
  const { toggleSidebar, setMobileSidebarOpen } = useUI();
  const { session, logout } = useAuth();
  // A vendor's portal has no partner directory or cross-module shortcuts to search or jump to.
  const isVendor = ['vendor', 'channel_partner'].includes((session?.accountRole as string | undefined) ?? '');
  const location = useLocation();
  const navigate = useNavigate();
  const crumb = resolveBreadcrumb(location.pathname);

  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const searchRef = useClickOutside(() => setSearchOpen(false));
  const quickRef = useClickOutside(() => setQuickOpen(false));
  const notifRef = useClickOutside(() => setNotifOpen(false));
  const profileRef = useClickOutside(() => setProfileOpen(false));

  const { theme, toggleTheme } = useTheme();
  const searchInput = useRef<HTMLInputElement>(null);
  // Ctrl/⌘K or "/" jumps to search from anywhere, unless the person is already typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName));
      if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && !typing)) {
        e.preventDefault();
        searchInput.current?.focus();
        searchInput.current?.select();
      }
      if (e.key === 'Escape' && document.activeElement === searchInput.current) {
        searchInput.current?.blur();
        setSearchOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const cachedHits = useMemo(() => searchCached(query), [query]);
  const bookingHits = useBookingHits(query);
  const results = useMemo(() => [...cachedHits, ...bookingHits].slice(0, 8), [cachedHits, bookingHits]);

  const [recentNotifications, setRecentNotifications] = useState<AppNotification[]>([]);
  useEffect(() => {
    // Loaded once per mount for the bell dropdown; a failure leaves it empty rather than
    // breaking the header.
    listNotifications({ pageSize: 5 })
      .then((page) => setRecentNotifications(page.items))
      .catch(() => setRecentNotifications([]));
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <header className="sticky top-0 z-20 flex h-12 items-center gap-2 border-b border-line bg-surface px-3 sm:px-4">
      <button
        type="button"
        onClick={() => setMobileSidebarOpen(true)}
        aria-label="Toggle navigation"
        className="rounded-md p-1.5 text-ink-muted hover:bg-surface-muted hover:text-ink focus-ring md:hidden"
      >
        <Menu size={17} />
      </button>
      <button
        type="button"
        onClick={toggleSidebar}
        aria-label="Toggle sidebar"
        className="hidden rounded-md p-1.5 text-ink-muted hover:bg-surface-muted hover:text-ink focus-ring md:inline-flex"
      >
        <Menu size={17} />
      </button>

      <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1.5 text-[13px] sm:flex">
        {crumb.childLabel && <><span className="truncate text-ink-subtle">{crumb.sectionLabel}</span><span className="text-ink-faint">/</span></>}
        <span className="truncate font-semibold text-ink" aria-current="page">{crumb.childLabel ?? crumb.sectionLabel}</span>
      </nav>

      {session?.accessExpiresAt && <TrialChip until={session.accessExpiresAt} />}

      <div className="ml-auto flex items-center gap-1 sm:gap-1.5">
        <div ref={searchRef} className={isVendor ? 'hidden' : 'relative'}>
          <div className="relative hidden md:block">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              ref={searchInput}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              placeholder="Search projects, bookings, partners"
              aria-label="Global search"
              aria-keyshortcuts="Control+K Meta+K /"
              className="h-8 w-60 rounded-lg border border-line bg-surface-subtle pl-8 pr-12 text-sm text-ink placeholder:text-ink-faint transition-colors duration-150 hover:border-line-strong focus:bg-surface focus-ring lg:w-72"
            />
            <span className="pointer-events-none absolute right-2 top-1/2 flex -translate-y-1/2 gap-0.5" aria-hidden="true">
              <kbd>{IS_MAC ? '⌘' : 'Ctrl'}</kbd><kbd>K</kbd>
            </span>
          </div>
          <button
            type="button"
            onClick={() => setSearchOpen((v) => !v)}
            aria-label="Search"
            className="rounded-md p-1.5 text-ink-muted hover:bg-surface-muted hover:text-ink focus-ring md:hidden"
          >
            <Search size={17} />
          </button>
          {searchOpen && query && (
            <div className="absolute right-0 top-10 z-30 w-80 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-popover">
              {results.length === 0 ? (
                <p className="px-3.5 py-4 text-center text-xs text-ink-faint">No matches for "{query}"</p>
              ) : (
                results.map((r) => (
                  <button
                    key={r.to + r.label}
                    onClick={() => {
                      navigate(r.to);
                      setSearchOpen(false);
                      setQuery('');
                    }}
                    className="flex w-full flex-col items-start px-3.5 py-2 text-left hover:bg-surface-subtle focus-ring"
                  >
                    <span className="text-sm font-medium text-ink">{r.label}</span>
                    <span className="text-xs text-ink-faint">{r.sub}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        <div ref={quickRef} className={isVendor ? 'hidden' : 'relative hidden sm:block'}>
          <button
            type="button"
            onClick={() => setQuickOpen((v) => !v)}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-line-strong px-2.5 text-sm font-medium text-ink-muted hover:bg-surface-muted hover:text-ink focus-ring"
          >
            <Plus size={14} />
            New
            <ChevronDown size={13} />
          </button>
          {quickOpen && (
            <div className="absolute right-0 top-10 z-30 w-52 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-popover">
              {QUICK_ACTIONS.map((qa) => (
                <button
                  key={qa.to}
                  onClick={() => {
                    navigate(qa.to);
                    setQuickOpen(false);
                  }}
                  className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm text-ink hover:bg-surface-subtle focus-ring"
                >
                  <qa.icon size={15} className="text-ink-faint" />
                  {qa.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
          className="rounded-md p-1.5 text-ink-muted hover:bg-surface-muted hover:text-ink focus-ring"
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>

        <div ref={notifRef} className="relative">
          <button
            type="button"
            onClick={() => setNotifOpen((v) => !v)}
            aria-label="Notifications"
            className="relative rounded-md p-1.5 text-ink-muted hover:bg-surface-muted hover:text-ink focus-ring"
          >
            <Bell size={18} />
            <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-accent-500" />
          </button>
          {notifOpen && (
            <div className="absolute right-0 top-10 z-30 w-80 overflow-hidden rounded-lg border border-line bg-surface shadow-popover">
              <div className="border-b border-line px-3.5 py-2.5">
                <p className="text-sm font-semibold text-ink">Notifications</p>
              </div>
              <div className="max-h-80 overflow-y-auto">
                {recentNotifications.map((n) => (
                  <div key={n.id} className="border-b border-line px-3.5 py-2.5 last:border-0 hover:bg-surface-subtle">
                    <p className="text-sm font-medium text-ink">{n.title}</p>
                    <p className="mt-0.5 line-clamp-1 text-xs text-ink-muted">{n.body}</p>
                    <p className="mt-1 text-[11px] text-ink-faint">{formatRelativeTime(n.createdAt)}</p>
                  </div>
                ))}
              </div>
              <button
                onClick={() => {
                  navigate('/notifications');
                  setNotifOpen(false);
                }}
                className="block w-full px-3.5 py-2.5 text-center text-xs font-medium text-brand-600 hover:bg-surface-subtle focus-ring"
              >
                View all notifications
              </button>
            </div>
          )}
        </div>

        <div ref={profileRef} className="relative">
          <button
            type="button"
            onClick={() => setProfileOpen((v) => !v)}
            className={cn('flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-surface-muted focus-ring', profileOpen && 'bg-surface-muted')}
          >
            <Avatar name={session?.name ?? 'Admin'} src={session?.avatarUrl} size="sm" />
            <span className="hidden flex-col items-start leading-tight md:flex">
              <span className="text-xs font-semibold text-ink">{session?.name}</span>
              <span className="text-[11px] text-ink-faint">{session?.roleName ?? 'Admin'}</span>
            </span>
            <ChevronDown size={13} className="hidden text-ink-faint md:block" />
          </button>
          {profileOpen && (
            <div className="absolute right-0 top-10 z-30 w-52 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-popover">
              <button
                onClick={() => {
                  navigate('/settings/profile');
                  setProfileOpen(false);
                }}
                className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm text-ink hover:bg-surface-subtle focus-ring"
              >
                <User size={15} className="text-ink-faint" />
                My Profile
              </button>
              <button
                onClick={() => {
                  navigate('/settings/security');
                  setProfileOpen(false);
                }}
                className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm text-ink hover:bg-surface-subtle focus-ring"
              >
                <ShieldCheck size={15} className="text-ink-faint" />
                Security
              </button>
              <div className="my-1 border-t border-line" />
              <button
                onClick={handleLogout}
                className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm text-danger-600 hover:bg-danger-50 focus-ring"
              >
                <LogOut size={15} />
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

/** Shown to a temporary client login: how long the trial has left. */
function TrialChip({ until }: { until: string }) {
  const ms = new Date(until).getTime() - Date.now();
  const hours = Math.max(0, Math.floor(ms / 3_600_000));
  const days = Math.ceil(ms / 86_400_000);
  const left = hours >= 24 ? `${days} day${days === 1 ? '' : 's'} left` : `${Math.max(1, hours)} h left`;
  const ends = new Date(until).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  return (
    <span
      className={cn('hidden shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs md:flex', hours < 24 ? 'border-warning-100 bg-warning-50 text-warning-700' : 'border-line bg-surface-subtle text-ink-muted')}
      title={`Your access ends ${ends}`}
    >
      Trial access · <span className="font-medium">{left}</span>
    </span>
  );
}
