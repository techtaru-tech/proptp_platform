import { useLocation } from 'react-router-dom';
import { useSection } from '../../app/useSection';
import { useAsync } from '../../hooks/useAsync';
import { getPageStats } from '../../services/sectionService';
import { KpiStrip } from './KpiStrip';

/**
 * The headline numbers of an inner page, under its title — the same strip as the Overviews.
 * Only inside a section, and only for pages the server has numbers for.
 */
export function PageStats() {
  const section = useSection();
  const { pathname } = useLocation();
  const skip = !section || section.onOverview;
  const { data } = useAsync(() => (skip ? Promise.resolve({ kpis: [] }) : getPageStats(pathname)), [pathname, skip]);
  return <KpiStrip kpis={data?.kpis ?? []} className="mb-4 print:hidden" />;
}
