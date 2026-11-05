import type { ReactNode } from 'react';
import proptoLockupWhite from '../assets/brand/propto-lockup-white.png';
import heroTowers from '../assets/dashboard/hero-towers.webp';

const HIGHLIGHTS = [
  'Leads, site visits and bookings',
  'Collections, payouts and commission statements',
  'Attendance, leave and payroll',
];

/**
 * The signed-out shell: a photo panel on the left (desktop only) and the form on the right,
 * inside one bordered card on the plain page background.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-subtle p-4 sm:p-6 lg:p-10">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-xl border border-line bg-surface lg:min-h-[600px] lg:grid-cols-[1.05fr_1fr]">
        <div className="relative hidden flex-col justify-between overflow-hidden bg-shell-950 p-10 text-white lg:flex">
          {/* A real photograph (Unsplash License), darkened so the copy stays readable. */}
          <img src={heroTowers} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover object-[60%_70%]" />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(4,26,49,0.86)_0%,rgba(4,26,49,0.55)_45%,rgba(4,26,49,0.92)_100%)]" />

          <img src={proptoLockupWhite} alt="Propto CRM" className="relative h-10 w-auto self-start" />

          <div className="relative">
            <p className="max-w-sm text-[15px] leading-relaxed text-white/85">
              The office side of Propto CRM — the same records your partners see in the app.
            </p>
            <ul className="mt-6 space-y-2 border-l border-white/20 pl-4 text-[13px] text-white/85">
              {HIGHLIGHTS.map((label) => <li key={label}>{label}</li>)}
            </ul>
          </div>

          <p className="relative text-xs text-white/50">© {new Date().getFullYear()} Propto CRM</p>
        </div>

        <div className="flex items-center justify-center px-6 py-10 sm:px-12 sm:py-14">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </div>
    </div>
  );
}
