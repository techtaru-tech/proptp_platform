import { fileUrl } from '../../services/apiClient';
import { cn } from '../../utils/cn';
import { initials } from '../../utils/format';

interface AvatarProps {
  name: string;
  src?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_CLASSES = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-14 w-14 text-base',
};

const PALETTE = ['bg-shell-100 text-steel-600', 'bg-accent-100 text-accent-700', 'bg-info-100 text-info-700', 'bg-success-100 text-success-700', 'bg-warning-100 text-warning-700'];

function colorFor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

export function Avatar({ name, src, size = 'md', className }: AvatarProps) {
  if (src) {
    return <img src={fileUrl(src)} alt={name} className={cn('rounded-full object-cover', SIZE_CLASSES[size], className)} />;
  }
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full font-semibold', SIZE_CLASSES[size], colorFor(name), className)}
      aria-hidden="true"
      title={name}
    >
      {initials(name)}
    </span>
  );
}
