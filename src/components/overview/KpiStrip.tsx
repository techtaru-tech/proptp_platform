import { formatCurrency } from '../../utils/format';
import { cn } from '../../utils/cn';
import { Stat } from '../../pages/dashboard/widgets';
import type { SectionKpi } from '../../services/sectionService';

const fmt = (k: SectionKpi) => (k.format === 'inr' ? formatCurrency(k.value) : k.format === 'pct' ? `${k.value}%` : k.value.toLocaleString('en-IN'));
// Literal class names so the build keeps them: up to six across, then rows of four (or three).
const XL = ['', 'xl:grid-cols-1', 'xl:grid-cols-2', 'xl:grid-cols-3', 'xl:grid-cols-4', 'xl:grid-cols-5', 'xl:grid-cols-6'];
const across = (n: number) => (n <= 6 ? n : n % 3 === 0 && n % 4 !== 0 ? 3 : 4);

/**
 * A row of headline numbers in one bordered strip. Each cell draws its own top and left rule and
 * sits a pixel outside it, so the outer border hides the edge ones and a short last row leaves
 * plain surface instead of a grey gap.
 */
export function KpiStrip({ kpis, className }: { kpis: SectionKpi[]; className?: string }) {
  if (!kpis.length) return null;
  return (
    <div className={cn('grid grid-cols-2 overflow-hidden rounded-xl border border-line bg-surface sm:grid-cols-3', XL[across(kpis.length)], className)}>
      {kpis.map((k) => (
        <div key={k.label} className="-ml-px -mt-px min-w-0 border-l border-t border-line">
          <Stat
            label={k.label} to={k.to} meta={k.meta} tone={k.tone === 'danger' ? 'danger' : undefined}
            value={<span className={cn(k.tone === 'warn' && 'text-accent-700', k.tone === 'good' && 'text-brand-700')}>{fmt(k)}</span>}
          />
        </div>
      ))}
    </div>
  );
}
