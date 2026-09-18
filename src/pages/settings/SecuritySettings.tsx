import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Copy, LogOut, Monitor, ShieldCheck, Smartphone } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { useToast } from '../../context/ToastContext';
import { formatDateTime, formatRelativeTime } from '../../utils/format';
import {
  changePassword, disableTwoFactor, enableTwoFactor, getTwoFactorStatus, listDeviceSessions,
  revokeDeviceSession, revokeOtherDeviceSessions, startTwoFactorSetup,
  type AdminDeviceSession, type TwoFactorStatus,
} from '../../services/authService';

export function SecuritySettings() {
  const { toast } = useToast();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [sessions, setSessions] = useState<AdminDeviceSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [signOutOthersOpen, setSignOutOthersOpen] = useState(false);

  const loadSessions = useCallback(async () => {
    try {
      setSessions(await listDeviceSessions());
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const handleChangePassword = async (e: FormEvent) => {
    e.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (!currentPassword) nextErrors.currentPassword = 'Current password is required.';
    // Matches the server's own minimum — a shorter one would only be rejected after the round trip.
    if (newPassword.length < 8) nextErrors.newPassword = 'New password must be at least 8 characters.';
    if (confirmPassword !== newPassword) nextErrors.confirmPassword = 'Passwords do not match.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setIsSaving(true);
    try {
      const { otherSessionsSignedOut } = await changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast({
        title: 'Password updated',
        description:
          otherSessionsSignedOut > 0
            ? `Use the new password next time. ${otherSessionsSignedOut} other device${otherSessionsSignedOut === 1 ? ' was' : 's were'} signed out.`
            : 'Use the new password the next time you sign in.',
        variant: 'success',
      });
      void loadSessions();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not update the password.';
      // The server returns this when the current password is wrong, so show it on that field.
      setErrors({ currentPassword: message });
      toast({ title: 'Could not update the password', description: message, variant: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const revokeSession = async (session: AdminDeviceSession) => {
    try {
      await revokeDeviceSession(session.id);
      toast({ title: `${session.device} signed out`, variant: 'success' });
      void loadSessions();
    } catch (err) {
      toast({ title: 'Could not sign that device out', description: err instanceof Error ? err.message : undefined, variant: 'error' });
    }
  };

  const signOutOthers = async () => {
    const count = await revokeOtherDeviceSessions();
    setSignOutOthersOpen(false);
    toast({
      title: count > 0 ? `${count} device${count === 1 ? '' : 's'} signed out` : 'No other devices were signed in',
      variant: 'success',
    });
    void loadSessions();
  };

  return (
    <div>
      <PageHeader
        title="Security"
        description="Manage your password, two-factor authentication and active sessions."
        breadcrumb={[{ label: 'Settings', to: '/settings/organization' }, { label: 'Security' }]}
      />


      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Change Password" subtitle="Update your admin account password" />
          <form onSubmit={handleChangePassword} noValidate className="space-y-4">
            <Input
              label="Current password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              error={errors.currentPassword}
            />
            <Input label="New password" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} error={errors.newPassword} />
            <Input
              label="Confirm new password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              error={errors.confirmPassword}
            />
            <Button type="submit" variant="primary" isLoading={isSaving}>
              Update Password
            </Button>
          </form>
        </Card>

        <TwoFactorCard />

        <Card className="lg:col-span-2">
          <CardHeader
            title="Active Sessions"
            subtitle="Every device holding a live sign-in to your account"
            action={
              sessions.length > 1 ? (
                <Button variant="outline" size="sm" leftIcon={<LogOut size={14} />} onClick={() => setSignOutOthersOpen(true)}>
                  Sign out all others
                </Button>
              ) : undefined
            }
          />
          {sessionsLoading ? (
            <p className="text-sm text-ink-faint">Loading...</p>
          ) : (
            <div className="divide-y divide-line">
              {sessions.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-4 py-3.5 first:pt-0 last:pb-0">
                  <div className="flex items-center gap-3">
                    <Monitor size={18} className="text-ink-faint" />
                    <div>
                      <p className="flex items-center gap-2 text-sm font-medium text-ink">
                        {s.device}
                        {s.current && <Badge tone="success">This device</Badge>}
                      </p>
                      <p className="text-xs text-ink-muted">
                        {s.ipAddress ?? 'Address unknown'} · last used{' '}
                        <span title={formatDateTime(s.lastSeenAt)}>{formatRelativeTime(s.lastSeenAt)}</span> · signed in{' '}
                        <span title={formatDateTime(s.createdAt)}>{formatRelativeTime(s.createdAt)}</span>
                      </p>
                    </div>
                  </div>
                  {!s.current && (
                    <Button variant="outline" size="sm" onClick={() => revokeSession(s)}>
                      Sign out
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <ConfirmationDialog
        isOpen={signOutOthersOpen}
        onClose={() => setSignOutOthersOpen(false)}
        onConfirm={signOutOthers}
        title="Sign out every other device?"
        description="Every session except this one stops working immediately and will have to sign in again."
        confirmLabel="Sign them out"
        variant="danger"
      />
    </div>
  );
}

/**
 * Enrolment in two steps, because a secret that was scanned wrong must not be able to lock
 * the account out: nothing is switched on until a code generated from it comes back correct.
 */
function TwoFactorCard() {
  const { toast } = useToast();
  const [status, setStatus] = useState<TwoFactorStatus | null>(null);
  const [setup, setSetup] = useState<{ secret: string; qrDataUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);

  const load = useCallback(async () => {
    setStatus(await getTwoFactorStatus());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const begin = async () => {
    setBusy(true);
    try {
      const started = await startTwoFactorSetup();
      setSetup({ secret: started.secret, qrDataUrl: started.qrDataUrl });
    } catch (err) {
      toast({ title: 'Could not start setup', description: err instanceof Error ? err.message : undefined, variant: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { recoveryCodes: codes } = await enableTwoFactor(code.trim());
      setRecoveryCodes(codes);
      setSetup(null);
      setCode('');
      await load();
      toast({ title: 'Two-factor authentication is on', variant: 'success' });
    } catch (err) {
      toast({ title: 'That code was not accepted', description: err instanceof Error ? err.message : undefined, variant: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    try {
      await disableTwoFactor(password);
      setPassword('');
      setDisableOpen(false);
      setRecoveryCodes(null);
      await load();
      toast({ title: 'Two-factor authentication is off', variant: 'info' });
    } catch (err) {
      toast({ title: 'Could not turn it off', description: err instanceof Error ? err.message : undefined, variant: 'error' });
    }
  };

  const copyCodes = async () => {
    if (!recoveryCodes) return;
    try {
      await navigator.clipboard.writeText(recoveryCodes.join('\n'));
      toast({ title: 'Recovery codes copied', variant: 'success' });
    } catch {
      toast({ title: 'Could not copy', description: 'Select and copy them by hand.', variant: 'error' });
    }
  };

  return (
    <Card>
      <CardHeader title="Two-Factor Authentication" subtitle="A code from your authenticator app at every sign-in" />

      {recoveryCodes && (
        <div className="mb-4 rounded-lg border border-warning-100 bg-warning-50 p-4">
          <p className="text-sm font-medium text-warning-700">Save these recovery codes now</p>
          <p className="mt-0.5 text-xs text-warning-700">
            Each one signs you in once if you lose your phone. They are not shown again.
          </p>
          <div className="my-3 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-xs text-ink">
            {recoveryCodes.map((rc) => (
              <span key={rc}>{rc}</span>
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" leftIcon={<Copy size={13} />} onClick={copyCodes}>
              Copy
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setRecoveryCodes(null)}>
              I have saved them
            </Button>
          </div>
        </div>
      )}

      {status?.enabled ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-success-100 bg-success-50 px-4 py-3">
            <span className="flex items-center gap-3">
              <ShieldCheck size={18} className="text-success-600" />
              <span>
                <span className="block text-sm font-medium text-ink">Authenticator app is on</span>
                <span className="block text-xs text-ink-muted">
                  Since {formatDateTime(status.enabledAt ?? '')} · {status.recoveryCodesRemaining} recovery codes left
                </span>
              </span>
            </span>
            <Button variant="outline" size="sm" onClick={() => setDisableOpen(true)}>
              Turn off
            </Button>
          </div>
        </div>
      ) : setup ? (
        <form onSubmit={confirm} className="space-y-4">
          <p className="text-sm text-ink-muted">
            Scan this with Google Authenticator, Authy or 1Password, then type the code it shows.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <img src={setup.qrDataUrl} alt="Two-factor QR code" className="rounded-lg border border-line" width={180} height={180} />
            <div className="min-w-0">
              <p className="text-xs text-ink-muted">Or enter this key by hand:</p>
              <code className="mt-1 block break-all rounded-lg border border-line bg-surface-subtle px-3 py-2 font-mono text-xs text-ink">
                {setup.secret}
              </code>
            </div>
          </div>
          <Input
            label="Code from the app"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
            autoComplete="one-time-code"
          />
          <div className="flex gap-2">
            <Button type="submit" variant="primary" isLoading={busy}>
              Turn on
            </Button>
            <Button type="button" variant="ghost" onClick={() => setSetup(null)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex items-center justify-between rounded-lg border border-line px-4 py-3">
          <div className="flex items-center gap-3">
            <Smartphone size={18} className="text-ink-faint" />
            <div>
              <p className="text-sm font-medium text-ink">Authenticator App</p>
              <p className="text-xs text-ink-muted">Require a verification code at sign-in.</p>
            </div>
          </div>
          <Button variant="primary" size="sm" isLoading={busy} onClick={begin}>
            Set up
          </Button>
        </div>
      )}

      {disableOpen && (
        <form
          className="mt-4 space-y-3 rounded-lg border border-danger-100 bg-danger-50 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void turnOff();
          }}
        >
          <p className="text-sm text-danger-700">
            Your account will be protected by its password alone. Confirm with that password to turn it off.
          </p>
          <Input label="Your password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          <div className="flex gap-2">
            <Button type="submit" variant="danger" size="sm" disabled={!password}>
              Turn it off
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setDisableOpen(false);
                setPassword('');
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
