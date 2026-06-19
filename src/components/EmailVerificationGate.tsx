import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

interface Props {
  email: string;
  onSignOut: () => void;
}

export function EmailVerificationGate({ email, onSignOut }: Props) {
  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);

  const handleResend = async () => {
    setSending(true);
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) throw error;
      toast({ title: 'Verification email sent', description: `Check ${email} for the confirmation link.` });
    } catch (e) {
      toast({
        title: 'Could not resend',
        description: e instanceof Error ? e.message : 'Please try again shortly.',
        variant: 'destructive',
      });
    } finally {
      setSending(false);
    }
  };

  const handleICheckedIt = async () => {
    setChecking(true);
    try {
      await supabase.auth.refreshSession();
      window.location.reload();
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center parchment-bg p-6">
      <div className="max-w-md w-full rounded-lg border border-border bg-card/80 backdrop-blur p-6 shadow-lg text-center space-y-4">
        <h1 className="font-display text-2xl text-primary text-glow">Confirm your email</h1>
        <p className="text-sm text-muted-foreground">
          We sent a confirmation link to <span className="font-mono text-foreground">{email}</span>.
          Click it to enter the realm.
        </p>
        <div className="flex flex-col gap-2 pt-2">
          <button
            onClick={handleICheckedIt}
            disabled={checking}
            className="w-full px-4 py-2 rounded-md bg-primary text-primary-foreground hover:opacity-90 transition disabled:opacity-50"
          >
            {checking ? 'Checking…' : "I've confirmed — let me in"}
          </button>
          <button
            onClick={handleResend}
            disabled={sending}
            className="w-full px-4 py-2 rounded-md border border-border hover:bg-muted transition disabled:opacity-50"
          >
            {sending ? 'Sending…' : 'Resend confirmation email'}
          </button>
          <button
            onClick={onSignOut}
            className="w-full px-4 py-2 rounded-md text-muted-foreground hover:text-foreground transition text-sm"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

export default EmailVerificationGate;
