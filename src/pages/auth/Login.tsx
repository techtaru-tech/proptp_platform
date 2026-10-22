import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Info, KeyRound, Lock, Mail } from 'lucide-react';
import { AuthLayout } from '../../layouts/AuthLayout';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { takeSignedOutReason } from '../../services/apiClient';
import techtaruLockup from '../../assets/brand/techtaru-lockup.png';

export function Login() {
  const { login, completeTwoFactorLogin, isLoading } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [showForgot, setShowForgot] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  /** Set once the password is accepted but the account still wants its second factor. */
  const [challengeToken, setChallengeToken] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  /** Why the last session ended, when it ended on its own rather than by signing out. */
  const [signedOutReason, setSignedOutReason] = useState<string | null>(null);

  // Read once and cleared, so a later visit to /login does not repeat a stale explanation.
  useEffect(() => setSignedOutReason(takeSignedOutReason()), []);

  const validate = () => {
    if (!email.trim()) return 'Email is required.';
    if (!/^\S+@\S+\.\S+$/.test(email)) return 'Enter a valid email address.';
    if (!password) return 'Password is required.';
    if (password.length < 4) return 'Password must be at least 4 characters.';
    return '';
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError('');
    try {
      const { twoFactorChallenge } = await login(email, password, remember);
      if (twoFactorChallenge) {
        setChallengeToken(twoFactorChallenge);
        return;
      }
      goToApp();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in. Please try again.');
    }
  };

  const goToApp = () => {
    const redirectTo = (location.state as { from?: string } | null)?.from ?? '/dashboard';
    navigate(redirectTo, { replace: true });
  };

  const handleTwoFactorSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!twoFactorCode.trim()) {
      setError('Enter the code from your authenticator app.');
      return;
    }
    setError('');
    try {
      await completeTwoFactorLogin(challengeToken, twoFactorCode.trim());
      goToApp();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That code was not accepted.');
    }
  };

  const handleForgotSubmit = (e: FormEvent) => {
    e.preventDefault();
    setResetSent(true);
    toast({ title: 'Reset link sent', description: 'Check your email for password reset instructions.', variant: 'success' });
  };

  if (challengeToken) {
    return (
      <AuthLayout>
        <div className="mb-7 flex justify-center lg:hidden">
          <img src={techtaruLockup} alt="TechTaru Digital" className="h-10 w-auto" />
        </div>
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-ink">Two-factor authentication</h1>
          <p className="mt-1.5 text-sm text-ink-muted">
            Enter the 6-digit code from your authenticator app. You can also use one of your recovery codes.
          </p>
        </div>
        <form onSubmit={handleTwoFactorSubmit} className="space-y-4">
          <Input
            label="Authentication code"
            value={twoFactorCode}
            onChange={(e) => setTwoFactorCode(e.target.value)}
            leftIcon={<KeyRound size={15} />}
            placeholder="123456"
            autoComplete="one-time-code"
            autoFocus
            error={error || undefined}
          />
          <Button type="submit" variant="primary" className="w-full" isLoading={isLoading}>
            Verify and sign in
          </Button>
          <button
            type="button"
            className="w-full text-center text-sm text-ink-muted hover:text-ink focus-ring"
            onClick={() => {
              setChallengeToken('');
              setTwoFactorCode('');
              setError('');
            }}
          >
            Use a different account
          </button>
        </form>
      </AuthLayout>
    );
  }

  if (showForgot) {
    return (
      <AuthLayout>
        <div className="mb-7 flex justify-center lg:hidden">
          <img src={techtaruLockup} alt="TechTaru Digital" className="h-10 w-auto" />
        </div>
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-ink">Reset your password</h1>
          <p className="mt-1.5 text-sm text-ink-muted">Enter your admin email and we'll send you a reset link.</p>
        </div>
        {resetSent ? (
          <div className="rounded-lg border border-success-100 bg-success-50 px-4 py-3 text-sm text-success-700">
            If an account exists for that email, a reset link has been sent.
          </div>
        ) : (
          <form onSubmit={handleForgotSubmit} className="space-y-4">
            <Input label="Email address" type="email" required leftIcon={<Mail size={15} />} placeholder="you@techtaru.com" />
            <Button type="submit" className="w-full" size="lg">
              Send reset link
            </Button>
          </form>
        )}
        <button
          type="button"
          onClick={() => {
            setShowForgot(false);
            setResetSent(false);
          }}
          className="mt-6 text-sm font-medium text-brand-600 hover:text-brand-700 focus-ring rounded"
        >
          ← Back to sign in
        </button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <div className="mb-7 flex justify-center lg:hidden">
        <img src={techtaruLockup} alt="TechTaru Digital" className="h-10 w-auto" />
      </div>
      <div className="mb-7">
        <h1 className="text-2xl font-semibold text-ink">Admin sign in</h1>
        <p className="mt-1.5 text-sm text-ink-muted">Sign in to manage projects, bookings, partners and operations.</p>
      </div>

      {signedOutReason && (
        <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-info-100 bg-info-50 px-4 py-3 text-sm text-info-700">
          <Info size={16} className="mt-0.5 shrink-0" />
          <p>{signedOutReason}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <Input
          label="Email address"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          leftIcon={<Mail size={15} />}
          placeholder="you@techtaru.com"
          autoComplete="username"
        />
        <Input
          label="Password"
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          leftIcon={<Lock size={15} />}
          placeholder="Enter your password"
          autoComplete="current-password"
        />

        {error && (
          <div role="alert" className="rounded-lg border border-danger-100 bg-danger-50 px-3.5 py-2.5 text-sm text-danger-700">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-4 w-4 rounded border-line-strong text-brand-600 focus-ring"
            />
            Remember me
          </label>
          <button
            type="button"
            onClick={() => setShowForgot(true)}
            className="text-sm font-medium text-brand-600 hover:text-brand-700 focus-ring rounded"
          >
            Forgot password?
          </button>
        </div>

        <Button type="submit" className="w-full" size="lg" isLoading={isLoading}>
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
