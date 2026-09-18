import { Link } from 'react-router-dom';
import { Avatar } from './Avatar';
import { StatusBadge } from './StatusBadge';
import type { AccountStatus, RoleId } from '../../types';
import { roleLabel } from '../../services/userService';

interface UserCardProps {
  name: string;
  role: RoleId;
  status: AccountStatus;
  subtitle?: string;
  avatarUrl?: string;
  to?: string;
}

export function UserCard({ name, role, status, subtitle, avatarUrl, to }: UserCardProps) {
  const content = (
    <div className="flex items-center gap-3 rounded-lg border border-line bg-white p-3 transition-colors hover:border-ink-faint">
      <Avatar name={name} src={avatarUrl} size="md" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{name}</p>
        <p className="truncate text-xs text-ink-muted">{subtitle ?? roleLabel(role)}</p>
      </div>
      <StatusBadge kind="account" status={status} dot={false} />
    </div>
  );

  return to ? (
    <Link to={to} className="block focus-ring rounded-lg">
      {content}
    </Link>
  ) : (
    content
  );
}
