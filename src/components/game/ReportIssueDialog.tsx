import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Bug } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Props {
  userId: string;
  characterId: string;
  characterName: string;
}

export default function ReportIssueDialog({ userId, characterId, characterName }: Props) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const trimmed = message.trim();
    if (!trimmed || trimmed.length < 5) {
      toast.error('Please describe the issue (at least 5 characters).');
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from('issue_reports' as any).insert({
      user_id: userId,
      character_id: characterId,
      character_name: characterName,
      message: trimmed,
    } as any);
    setSubmitting(false);
    if (error) {
      toast.error('Failed to submit report: ' + error.message);
    } else {
      toast.success('Issue reported — thank you!');
      setMessage('');
      setOpen(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-xs text-muted-foreground gap-1">
          <Bug className="h-3 w-3" />
          Report
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-display text-sm">Report an Issue</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-muted-foreground">Character:</span>
              <span className="ml-1 font-display">{characterName}</span>
            </div>
          </div>
          <Textarea
            placeholder="Describe the issue..."
            value={message}
            onChange={e => setMessage(e.target.value)}
            maxLength={1000}
            className="min-h-[100px] text-sm"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSubmit} disabled={submitting || message.trim().length < 5}>
              {submitting ? 'Sending…' : 'Submit'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
