import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2 } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

interface IssueReport {
  id: string;
  user_id: string;
  character_id: string | null;
  character_name: string;
  message: string;
  status: string;
  created_at: string;
}

export default function IssueReportManager() {
  const [reports, setReports] = useState<IssueReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('open');

  const load = async () => {
    setLoading(true);
    let query = supabase.from('issue_reports' as any).select('*').order('created_at', { ascending: false });
    if (filter !== 'all') {
      query = query.eq('status', filter);
    }
    const { data, error } = await query;
    if (error) toast.error(error.message);
    setReports((data as any as IssueReport[]) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [filter]);

  const updateStatus = async (id: string, status: string) => {
    const { error } = await supabase.from('issue_reports' as any).update({ status } as any).eq('id', id);
    if (error) toast.error(error.message);
    else load();
  };

  const deleteReport = async (id: string) => {
    if (!window.confirm('Delete this report?')) return;
    const { error } = await supabase.from('issue_reports' as any).delete().eq('id', id);
    if (error) toast.error(error.message);
    else load();
  };

  const statusColor = (s: string) => {
    if (s === 'open') return 'destructive';
    if (s === 'in_progress') return 'default';
    return 'secondary';
  };

  return (
    <div className="h-full flex flex-col p-4 gap-3">
      <div className="flex items-center gap-3">
        <h2 className="font-display text-sm text-primary">Issue Reports</h2>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-32 h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">{reports.length} report(s)</span>
      </div>

      <ScrollArea className="flex-1">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs w-36">Date</TableHead>
              <TableHead className="text-xs w-28">Character</TableHead>
              <TableHead className="text-xs">Message</TableHead>
              <TableHead className="text-xs w-28">Status</TableHead>
              <TableHead className="text-xs w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={5} className="text-xs text-muted-foreground text-center">Loading…</TableCell></TableRow>
            ) : reports.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-xs text-muted-foreground text-center">No reports found</TableCell></TableRow>
            ) : reports.map(r => (
              <TableRow key={r.id}>
                <TableCell className="text-[10px] text-muted-foreground">
                  {new Date(r.created_at).toLocaleString()}
                </TableCell>
                <TableCell className="text-xs font-display">{r.character_name || '—'}</TableCell>
                <TableCell className="text-xs max-w-md">
                  <p className="whitespace-pre-wrap break-words">{r.message}</p>
                </TableCell>
                <TableCell>
                  <Select value={r.status} onValueChange={(v) => updateStatus(r.id, v)}>
                    <SelectTrigger className="h-6 text-[10px] w-24">
                      <Badge variant={statusColor(r.status) as any} className="text-[9px]">{r.status}</Badge>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="in_progress">In Progress</SelectItem>
                      <SelectItem value="resolved">Resolved</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => deleteReport(r.id)}>
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollArea>
    </div>
  );
}
