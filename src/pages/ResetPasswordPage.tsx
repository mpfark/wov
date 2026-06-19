import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import logo from '@/assets/logo.png';

function validateNewPassword(pw: string): string | null {
  if (pw.length < 10) return 'Password must be at least 10 characters.';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) {
    return 'Password must include both letters and numbers.';
  }
  return null;
}

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [linkExpired, setLinkExpired] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    // Listen for the PASSWORD_RECOVERY event which fires when
    // the user arrives via the recovery link
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setReady(true);
      }
    });

    // Also check if we already have a session (user may have already been auto-logged in)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true);
    });

    // If no recovery session has materialised after ~6s, the link was almost
    // certainly expired or already used. Show a clear path forward instead of
    // leaving the user staring at a perpetual "Verifying..." spinner.
    const expiredTimer = setTimeout(() => {
      setLinkExpired((prev) => prev || true);
    }, 6000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(expiredTimer);
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    const pwError = validateNewPassword(password);
    if (pwError) {
      toast.error(pwError);
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success('Password updated! Redirecting...');
      setTimeout(() => navigate('/'), 1500);
    } catch (err: any) {
      toast.error(err.message || 'Failed to update password');
    } finally {
      setLoading(false);
    }
  };

  if (!ready) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center parchment-bg p-4">
        <img src={logo} alt="Wayfarers of Varneth" className="w-28 h-28 mb-4 drop-shadow-[0_0_15px_rgba(218,165,32,0.4)]" />
        {linkExpired ? (
          <div className="text-center max-w-sm">
            <p className="font-display text-primary text-glow mb-2">Recovery link expired</p>
            <p className="text-sm text-muted-foreground mb-4">
              This password reset link is no longer valid. Request a fresh one from the sign-in page.
            </p>
            <Button onClick={() => navigate('/')} className="font-display">
              Back to sign in
            </Button>
          </div>
        ) : (
          <p className="font-display text-primary text-glow animate-pulse">Verifying recovery link...</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center parchment-bg p-4">
      <img src={logo} alt="Wayfarers of Varneth" className="w-28 h-28 mb-4 drop-shadow-[0_0_15px_rgba(218,165,32,0.4)]" />
      <Card className="w-full max-w-md ornate-border bg-card/90 backdrop-blur">
        <CardHeader className="text-center">
          <CardTitle className="font-display text-xl text-foreground">Set New Password</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">Choose a new password for your account</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-display text-foreground">New Password</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={10}
                className="mt-1 bg-input border-border"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                At least 10 characters, with letters and numbers.
              </p>
            </div>
            <div>
              <label className="text-sm font-display text-foreground">Confirm Password</label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={10}
                className="mt-1 bg-input border-border"
              />
            </div>
            <Button type="submit" disabled={loading} className="w-full font-display">
              {loading ? 'Updating...' : 'Update Password'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
