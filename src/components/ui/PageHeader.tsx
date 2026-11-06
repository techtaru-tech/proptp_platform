import type { ReactNode } from 'react';
import { Breadcrumb, type BreadcrumbItem } from './Breadcrumb';

interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  breadcrumb?: BreadcrumbItem[];
  actions?: ReactNode;
}

export function PageHeader({ title, description, breadcrumb, actions }: PageHeaderProps) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {breadcrumb && <div className="mb-1.5">
          <Breadcrumb items={breadcrumb} />
        </div>}
        <h1 className="text-xl font-bold text-ink">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-ink-subtle">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2 print:hidden">{actions}</div>}
    </div>
  );
}
