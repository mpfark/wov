import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { APP_VERSION } from '@/lib/version';
import logo from '@/assets/logo.png';

export default function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn, signUp, resetPassword } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isForgotPassword) {
        const { error } = await resetPassword(email);
        if (error) throw error;
        toast.success('Password reset email sent! Check your inbox.');
        setIsForgotPassword(false);
      } else if (isLogin) {
        const { error } = await signIn(email, password);
        if (error) throw error;
      } else {
        const { error } = await signUp(email, password);
        if (error) throw error;
        toast.success('Check your email to confirm your account!');
      }
    } catch (err: any) {
      toast.error(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const heading = isForgotPassword
    ? 'Reset Password'
    : isLogin
      ? 'Enter the Realm'
      : 'Join the Fellowship';

  const subtitle = isForgotPassword
    ? 'Send a raven to recover your path.'
    : isLogin
      ? 'The realm remembers you.'
      : 'Begin your tale among the Wayfarers.';

  const submitLabel = loading
    ? 'Journeying...'
    : isForgotPassword
      ? 'Send Reset Link'
      : isLogin
        ? 'Enter the Realm'
        : 'Create Account';

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center gateway-bg p-4 overflow-hidden">
      {/* Atmospheric layers */}
      <div className="gateway-fog hidden sm:block" aria-hidden="true" />
      <div className="gateway-vignette" aria-hidden="true" />

      {/* Card column */}
      <div className="relative z-10 w-full max-w-md flex flex-col items-center animate-gateway-enter">
        {/* Emblem — overlaps the top edge of the card like a wax seal */}
        <div className="relative -mb-10 sm:-mb-12 z-20">
          <div className="gateway-emblem p-3 sm:p-4">
            <img
              src={logo}
              alt="Wayfarers of Varneth emblem"
              className="w-16 h-16 sm:w-20 sm:h-20 drop-shadow-[0_0_12px_rgba(218,165,32,0.55)]"
            />
          </div>
        </div>

        {/* Sealed gateway panel */}
        <div className="gateway-card w-full pt-14 sm:pt-16 pb-6 px-6 sm:px-8">
          <div className="text-center mb-6">
            <h1 className="font-display text-2xl sm:text-3xl text-primary text-glow leading-tight">
              Wayfarers of Varneth
            </h1>
            <h2 className="font-display text-base sm:text-lg text-foreground mt-3">
              {heading}
            </h2>
            <p className="text-sm italic text-muted-foreground mt-1">
              {subtitle}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-display text-foreground tracking-wide" htmlFor="auth-email">
                Email
              </label>
              <Input
                id="auth-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="wayfarer@varneth.com"
                required
                className="mt-1 gateway-input"
              />
            </div>
            {!isForgotPassword && (
              <div>
                <label className="text-sm font-display text-foreground tracking-wide" htmlFor="auth-password">
                  Password
                </label>
                <Input
                  id="auth-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={6}
                  className="mt-1 gateway-input"
                />
              </div>
            )}
            <Button
              type="submit"
              disabled={loading}
              className="w-full font-display tracking-wide gateway-btn h-11 mt-2"
            >
              {submitLabel}
            </Button>
          </form>

          <div className="mt-5 flex flex-col items-center gap-2">
            {isLogin && !isForgotPassword && (
              <button
                type="button"
                onClick={() => setIsForgotPassword(true)}
                className="text-xs gateway-link"
              >
                Forgot your password?
              </button>
            )}
            <button
              type="button"
              onClick={() => { setIsLogin(!isLogin); setIsForgotPassword(false); }}
              className="text-xs gateway-link"
            >
              {isForgotPassword
                ? 'Back to sign in'
                : isLogin
                  ? 'No account? Join the Fellowship'
                  : 'Already have an account? Enter'}
            </button>
          </div>
        </div>

        {/* Subtle version footer */}
        <p className="mt-4 text-[11px] tracking-widest uppercase text-muted-foreground/60 font-display">
          {APP_VERSION}
        </p>
      </div>
    </div>
  );
}
