import type { ReactNode } from 'react';
import { BarChart3, ShieldCheck, Users } from 'lucide-react';
import proptoLockupWhite from '../assets/brand/propto-lockup-white.png';

const HIGHLIGHTS = [
  { icon: BarChart3, label: 'Projects, bookings and payments in one console' },
  { icon: Users, label: 'Partners, teams, attendance and payouts' },
  { icon: ShieldCheck, label: 'Role-based access with a full audit trail' },
];

/**
 * The signed-out shell: one rounded card floating on a tinted page, brand panel on the left
 * (desktop only) and the form on the right. The page padding is what gives the card air on
 * every side — it is deliberately not a full-bleed split.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-surface-subtle via-surface to-brand-50 p-4 sm:p-6 lg:p-10">
      <div className="grid w-full max-w-6xl overflow-hidden rounded-3xl border border-line bg-white shadow-popover lg:min-h-[640px] lg:grid-cols-2">
        <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-shell-950 via-shell-900 to-brand-800 p-12 text-white lg:flex">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.14),transparent_45%)]" />

          {/* Navy into Propto green, like proptocrm.com's dark sections, with the white-text
              lockup set directly on it. */}
          <div className="relative">
            <img src={proptoLockupWhite} alt="Propto CRM" className="h-14 w-auto" />
          </div>

          <div className="relative">
            <h2 className="text-4xl font-semibold leading-tight">Partner &amp; Operations Admin Panel</h2>
            <p className="mt-4 text-base leading-relaxed text-white/80">
              Everything your operations team runs on, in a single secure console.
            </p>

            <ul className="mt-9 space-y-4">
              {HIGHLIGHTS.map(({ icon: Icon, label }) => (
                <li key={label} className="flex items-start gap-3 text-sm text-white/90">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/15 backdrop-blur">
                    <Icon size={14} />
                  </span>
                  {label}
                </li>
              ))}
            </ul>
          </div>

          <p className="relative text-xs text-white/60">© {new Date().getFullYear()} Propto CRM. All rights reserved.</p>
        </div>

        <div className="flex items-center justify-center px-6 py-12 sm:px-14 sm:py-16">
          <div className="w-full max-w-md">{children}</div>
        </div>
      </div>
    </div>
  );
}
