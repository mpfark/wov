import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { ArrowLeft, Save } from 'lucide-react';

interface Props {
  onBack: () => void;
}

export default function ProfilePage({ onBack }: Props) {
  const { user } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [originalName, setOriginalName] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase
      .from('profiles')
      .select('display_name, full_name')
      .eq('user_id', user.id)
      .single()
      .then(({ data }) => {
        const name = data?.display_name ?? '';
        setDisplayName(name);
        setOriginalName(name);
        setFullName(data?.full_name ?? '');
        setLoading(false);
      });
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    const trimmed = displayName.trim();
    if (!trimmed) {
      toast.error('Display name cannot be empty.');
      return;
    }
    if (trimmed.length > 30) {
      toast.error('Display name must be 30 characters or less.');
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from('profiles')
      .update({ display_name: trimmed })
      .eq('user_id', user.id);
    setSaving(false);
    if (error) {
      toast.error('Failed to update display name.');
    } else {
      setOriginalName(trimmed);
      setDisplayName(trimmed);
      toast.success('Display name updated!');
    }
  };

  const hasChanges = displayName.trim() !== originalName;

  return (
    <div className="flex min-h-screen items-center justify-center parchment-bg p-4">
      <div className="w-full max-w-md space-y-4">
        <Button variant="ghost" size="sm" onClick={onBack} className="text-muted-foreground">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>

        <Card className="ornate-border bg-card/90 backdrop-blur">
          <CardHeader>
            <CardTitle className="font-display text-xl text-primary">Account Profile</CardTitle>
            <p className="text-sm text-muted-foreground">{user?.email}</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? (
              <p className="text-sm text-muted-foreground animate-pulse">Loading...</p>
            ) : (
              <>
                <div>
                  <label className="text-sm font-display text-foreground">Display Name</label>
                  <Input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Your display name"
                    maxLength={30}
                    className="mt-1 bg-input border-border"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    This is your account name, not your character name.
                  </p>
                </div>
                <Button
                  onClick={handleSave}
                  disabled={saving || !hasChanges}
                  className="w-full font-display"
                >
                  <Save className="h-4 w-4 mr-1" />
                  {saving ? 'Saving...' : 'Save Changes'}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
