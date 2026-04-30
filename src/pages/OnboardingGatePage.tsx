import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Shield } from 'lucide-react';

interface Props {
  userId: string;
  onComplete: () => void;
}

const OATH_TEXT =
  'I swear upon the realm of Varneth to uphold honor, play with integrity, and respect my fellow wayfarers. I shall not exploit, cheat, or disrupt the world we share.';

export default function OnboardingGatePage({ userId, onComplete }: Props) {
  const [fullName, setFullName] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [saving, setSaving] = useState(false);

  const trimmed = fullName.trim();
  const canSubmit = trimmed.length >= 2 && trimmed.length <= 60 && accepted;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    // Default display_name to full_name unless the player has already set a custom one.
    const { data: existing } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('user_id', userId)
      .maybeSingle();
    const currentDisplay = existing?.display_name?.trim();
    const payload: {
      user_id: string;
      full_name: string;
      has_accepted_oath: boolean;
      display_name?: string;
    } = {
      user_id: userId,
      full_name: trimmed,
      has_accepted_oath: true,
    };
    if (!currentDisplay) payload.display_name = trimmed;

    const { error } = await supabase
      .from('profiles')
      .upsert(payload, { onConflict: 'user_id' });
    setSaving(false);
    if (error) {
      toast.error('Something went wrong. Please try again.');
      return;
    }
    toast.success('Welcome, wayfarer!');
    onComplete();
  };

  return (
    <div className="flex min-h-screen items-center justify-center parchment-bg p-4">
      <div className="w-full max-w-md">
        <Card className="ornate-border bg-card/90 backdrop-blur">
          <CardHeader className="text-center space-y-2">
            <Shield className="h-10 w-10 mx-auto text-primary" />
            <CardTitle className="font-display text-2xl text-primary">
              The Wayfarer's Oath
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Before you enter the realm, we ask for your name and your word.
            </p>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Full Name */}
            <div className="space-y-1.5">
              <label className="text-sm font-display text-foreground">
                Full Name
              </label>
              <Input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="First and last name"
                maxLength={60}
                className="bg-input border-border"
              />
              <p className="text-xs text-muted-foreground">
                Your real name — this is private and will not be shown to other players.
              </p>
            </div>

            {/* Oath */}
            <div className="space-y-2">
              <div className="rounded-md border border-border bg-muted/30 p-3">
                <p className="text-sm italic text-foreground leading-relaxed">
                  "{OATH_TEXT}"
                </p>
              </div>
              <div className="flex items-start gap-2">
                <Checkbox
                  id="oath"
                  checked={accepted}
                  onCheckedChange={(v) => setAccepted(v === true)}
                  className="mt-0.5"
                />
                <label
                  htmlFor="oath"
                  className="text-sm text-muted-foreground cursor-pointer leading-snug"
                >
                  I swear this oath and agree to play with honor.
                </label>
              </div>
            </div>

            <Button
              onClick={handleSubmit}
              disabled={!canSubmit || saving}
              className="w-full font-display"
            >
              {saving ? 'Entering the realm...' : 'Enter the Realm'}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
