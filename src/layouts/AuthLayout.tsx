import type { ReactNode } from 'react';
import { BarChart3, ShieldCheck, Users } from 'lucide-react';
import shreeramLogo from '../assets/brand/shreeram-logo.png';

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
        <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-brand-700 via-brand-600 to-accent-500 p-12 text-white lg:flex">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.14),transparent_45%)]" />

          {/* The logo has its own solid red background, so it sits on a white chip rather than
              directly on the gradient, where the two reds would muddy each other. */}
          <div className="relative">
            <span className="inline-flex rounded-xl bg-white p-2.5 shadow-card">
              <img src={shreeramLogo} alt="Shree Ram Group" className="h-9 w-auto" />
            </span>
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

          <p className="relative text-xs text-white/60">© {new Date().getFullYear()} Shree Ram Group. All rights reserved.</p>
        </div>

        <div className="flex items-center justify-center px-6 py-12 sm:px-14 sm:py-16">
          <div className="w-full max-w-md">{children}</div>
        </div>
      </div>
    </div>
  );
}
