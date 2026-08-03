import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ServicePanelShell, ServicePanelEmpty } from '@/components/ui/ServicePanelShell';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Crown, Scroll, UserMinus, Check, X, Clock } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  characterId: string;
  currentFamilyName?: string | null;
  familyChangedAfterCreation?: boolean;
  userId: string;
  npcName?: string;
  npcFlavor?: string;
  onFamilyChanged?: () => void;
}

type Tab = 'change' | 'founder' | 'memberships' | 'requests';

interface FamilyRow { id: string; display_name: string; key: string; founder_user_id: string; }
interface MemberRow { user_id: string; joined_at: string; display: string; }
interface RequestRow { id: string; family_id: string; requester_user_id: string; status: string; created_at: string; family?: FamilyRow | null; requester_display?: string; }

export default function HeraldryPanel({
  open, onClose, characterId, currentFamilyName, familyChangedAfterCreation,
  userId, npcName, npcFlavor, onFamilyChanged,
}: Props) {
  const [tab, setTab] = useState<Tab>('change');

  // Set / change
  const [newFamily, setNewFamily] = useState('');
  const [checkStatus, setCheckStatus] = useState<any>(null);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);

  // Founder
  const [foundedFamilies, setFoundedFamilies] = useState<FamilyRow[]>([]);
  const [foundedMembers, setFoundedMembers] = useState<Record<string, MemberRow[]>>({});
  const [incomingRequests, setIncomingRequests] = useState<RequestRow[]>([]);

  // Memberships
  const [memberships, setMemberships] = useState<FamilyRow[]>([]);

  // Outgoing requests
  const [outgoing, setOutgoing] = useState<RequestRow[]>([]);

  const loadAll = useCallback(async () => {
    // Families I founded
    const { data: founded } = await supabase.from('families')
      .select('id, key, display_name, founder_user_id')
      .eq('founder_user_id', userId)
      .order('created_at', { ascending: true });
    setFoundedFamilies((founded ?? []) as FamilyRow[]);

    // Members of each founded family
    if (founded && founded.length > 0) {
      const ids = founded.map(f => f.id);
      const { data: mems } = await supabase.from('family_members')
        .select('family_id, user_id, joined_at')
        .in('family_id', ids);
      const userIds = Array.from(new Set((mems ?? []).map(m => m.user_id)));
      const { data: profs } = userIds.length
        ? await supabase.from('profiles').select('user_id, full_name').in('user_id', userIds)
        : { data: [] as any[] };
      const profMap = new Map((profs ?? []).map((p: any) => [p.user_id, p.full_name || 'Unknown wayfarer']));
      const grouped: Record<string, MemberRow[]> = {};
      for (const m of mems ?? []) {
        (grouped[m.family_id] ||= []).push({
          user_id: m.user_id, joined_at: m.joined_at,
          display: profMap.get(m.user_id) || 'Unknown wayfarer',
        });
      }
      setFoundedMembers(grouped);
    } else {
      setFoundedMembers({});
    }

    // Incoming requests on my families
    const { data: incoming } = await supabase.from('family_requests')
      .select('id, family_id, requester_user_id, status, created_at, family:families(id, key, display_name, founder_user_id)')
      .eq('status', 'pending');
    const filteredIncoming = (incoming ?? []).filter((r: any) => r.family?.founder_user_id === userId);
    const reqIds = Array.from(new Set(filteredIncoming.map((r: any) => r.requester_user_id)));
    const { data: reqProfs } = reqIds.length
      ? await supabase.from('profiles').select('user_id, full_name').in('user_id', reqIds)
      : { data: [] as any[] };
    const reqProfMap = new Map((reqProfs ?? []).map((p: any) => [p.user_id, p.full_name || 'Unknown wayfarer']));
    setIncomingRequests(filteredIncoming.map((r: any) => ({
      ...r, requester_display: reqProfMap.get(r.requester_user_id) || 'Unknown wayfarer',
    })));

    // Memberships
    const { data: mems2 } = await supabase.from('family_members')
      .select('family_id, family:families(id, key, display_name, founder_user_id)')
      .eq('user_id', userId);
    setMemberships(((mems2 ?? []) as any[]).map(m => m.family).filter(Boolean) as FamilyRow[]);

    // Outgoing requests
    const { data: out } = await supabase.from('family_requests')
      .select('id, family_id, requester_user_id, status, created_at, family:families(id, key, display_name, founder_user_id)')
      .eq('requester_user_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    setOutgoing((out ?? []) as RequestRow[]);
  }, [userId]);

  useEffect(() => { if (open) loadAll(); }, [open, loadAll]);

  const handleCheck = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) { setCheckStatus(null); return; }
    if (!/^[A-Za-z]{2,20}$/.test(trimmed)) {
      setCheckStatus({ status: 'invalid' });
      return;
    }
    setChecking(true);
    try {
      const { data, error } = await supabase.rpc('check_family_name', { _display: trimmed });
      if (error) throw error;
      setCheckStatus(data);
    } catch (err: any) {
      toast.error(err.message || 'Check failed');
    } finally { setChecking(false); }
  };

  const handleApply = async () => {
    const trimmed = newFamily.trim();
    if (!trimmed) return;
    setApplying(true);
    try {
      const { error } = await supabase.rpc('change_family_at_heraldry', {
        _character_id: characterId, _display: trimmed,
      });
      if (error) throw error;
      toast.success(`Your character now bears the ${trimmed} family name.`);
      setNewFamily('');
      setCheckStatus(null);
      onFamilyChanged?.();
    } catch (err: any) {
      toast.error(err.message || 'Could not apply family name');
    } finally { setApplying(false); }
  };

  const handleClear = async () => {
    setApplying(true);
    try {
      const { error } = await supabase.rpc('change_family_at_heraldry', {
        _character_id: characterId, _display: '',
      });
      if (error) throw error;
      toast.success('Family name removed.');
      onFamilyChanged?.();
    } catch (err: any) {
      toast.error(err.message || 'Could not clear family name');
    } finally { setApplying(false); }
  };

  const handleRequestJoin = async () => {
    try {
      const { error } = await supabase.rpc('request_family_membership', { _display: newFamily.trim() });
      if (error) throw error;
      toast.success('Request sent.');
      setCheckStatus((prev: any) => prev ? { ...prev, status: 'request_pending' } : prev);
      loadAll();
    } catch (err: any) { toast.error(err.message || 'Request failed'); }
  };

  const resolveReq = async (id: string, approve: boolean) => {
    try {
      const { error } = await supabase.rpc('resolve_family_request', { _request_id: id, _approve: approve });
      if (error) throw error;
      toast.success(approve ? 'Approved.' : 'Denied.');
      loadAll();
    } catch (err: any) { toast.error(err.message); }
  };

  const cancelReq = async (id: string) => {
    try {
      const { error } = await supabase.rpc('cancel_family_request', { _request_id: id });
      if (error) throw error;
      loadAll();
    } catch (err: any) { toast.error(err.message); }
  };

  const leaveFamily = async (familyId: string) => {
    try {
      const { error } = await supabase.rpc('leave_family', { _family_id: familyId });
      if (error) throw error;
      toast.success('You have left the family.');
      loadAll();
    } catch (err: any) { toast.error(err.message); }
  };

  const revokeMember = async (familyId: string, userToRevoke: string) => {
    try {
      const { error } = await supabase.rpc('revoke_family_membership', { _family_id: familyId, _user_id: userToRevoke });
      if (error) throw error;
      toast.success('Membership revoked.');
      loadAll();
    } catch (err: any) { toast.error(err.message); }
  };

  return (
    <ServicePanelShell
      open={open}
      onClose={onClose}
      title={npcName ? `${npcName}, Herald` : 'Heraldry'}
      subtitle={npcFlavor || 'Claim, change, or steward a family name.'}
      tabs={
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="w-full">
          <TabsList className="w-full grid grid-cols-4">
            <TabsTrigger value="change" className="text-xs">Set / Change</TabsTrigger>
            <TabsTrigger value="founder" className="text-xs">
              My Families {foundedFamilies.length > 0 && <span className="ml-1 text-primary">({foundedFamilies.length})</span>}
              {incomingRequests.length > 0 && <span className="ml-1 text-elvish">●</span>}
            </TabsTrigger>
            <TabsTrigger value="memberships" className="text-xs">Memberships</TabsTrigger>
            <TabsTrigger value="requests" className="text-xs">
              Outgoing {outgoing.length > 0 && <span className="ml-1 text-primary">({outgoing.length})</span>}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      }
      left={
        <div className="p-3 space-y-3">
          {tab === 'change' && (
            <div className="space-y-3">
              <div className="text-xs text-muted-foreground">
                Current family name:{' '}
                <span className="font-display text-primary">{currentFamilyName || '— none —'}</span>
              </div>
              {familyChangedAfterCreation ? (
                <ServicePanelEmpty>
                  You have already used your Heraldry change for this character.
                </ServicePanelEmpty>
              ) : (
                <>
                  <Input
                    value={newFamily}
                    onChange={(e) => {
                      const v = e.target.value.replace(/[^A-Za-z]/g, '').slice(0, 20);
                      setNewFamily(v); setCheckStatus(null);
                    }}
                    onBlur={(e) => handleCheck(e.target.value)}
                    placeholder="New family name (letters only, 2–20)"
                    className="bg-input border-border text-sm"
                    maxLength={20}
                  />
                  {newFamily && (
                    <div className="text-[11px] leading-tight min-h-[16px]">
                      {checking && <span className="text-muted-foreground italic">Checking…</span>}
                      {!checking && checkStatus?.status === 'invalid' && <span className="text-destructive">Letters only, 2–20 characters.</span>}
                      {!checking && checkStatus?.status === 'reserved' && <span className="text-destructive">That name is reserved.</span>}
                      {!checking && checkStatus?.status === 'available' && <span className="text-elvish">Available — you'll found this family.</span>}
                      {!checking && checkStatus?.status === 'founder' && <span className="text-primary">Your family.</span>}
                      {!checking && checkStatus?.status === 'member' && <span className="text-primary">Member — you may use this.</span>}
                      {!checking && checkStatus?.status === 'needs_request' && (
                        <span className="text-muted-foreground">
                          Founded by <span className="text-primary">{checkStatus.founder_display_name}</span>.{' '}
                          <button type="button" onClick={handleRequestJoin} className="underline text-primary hover:text-primary/80">
                            Request to join
                          </button>
                        </span>
                      )}
                      {!checking && checkStatus?.status === 'request_pending' && (
                        <span className="text-muted-foreground italic">Request pending founder's approval.</span>
                      )}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button
                      onClick={handleApply}
                      disabled={applying || !newFamily.trim() || !checkStatus || !['available', 'founder', 'member'].includes(checkStatus.status)}
                      className="flex-1"
                    >
                      {applying ? 'Inscribing…' : 'Adopt Family Name'}
                    </Button>
                    {currentFamilyName && (
                      <Button variant="outline" onClick={handleClear} disabled={applying}>
                        Remove
                      </Button>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground italic">
                    You may use this change only once per character.
                  </p>
                </>
              )}
            </div>
          )}

          {tab === 'founder' && (
            <div className="space-y-3">
              {foundedFamilies.length === 0 ? (
                <ServicePanelEmpty>You have not founded any families yet.</ServicePanelEmpty>
              ) : foundedFamilies.map(fam => (
                <div key={fam.id} className="surface-row p-2 rounded space-y-1">
                  <div className="flex items-center gap-2 font-display text-sm">
                    <Crown className="w-3.5 h-3.5 text-primary" /> {fam.display_name}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Members ({(foundedMembers[fam.id] ?? []).length}):
                  </div>
                  {(foundedMembers[fam.id] ?? []).length === 0 && (
                    <div className="text-[11px] italic text-muted-foreground pl-2">No approved members yet.</div>
                  )}
                  {(foundedMembers[fam.id] ?? []).map(m => (
                    <div key={m.user_id} className="flex items-center justify-between text-[11px] pl-2">
                      <span>{m.display}</span>
                      <Button size="sm" variant="ghost" className="h-5 px-2 text-destructive" onClick={() => revokeMember(fam.id, m.user_id)}>
                        <UserMinus className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              ))}

              {incomingRequests.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-border">
                  <div className="text-xs font-display text-elvish">Incoming requests</div>
                  {incomingRequests.map(r => (
                    <div key={r.id} className="surface-row p-2 rounded flex items-center justify-between text-xs">
                      <div>
                        <span className="text-foreground">{r.requester_display}</span>
                        <span className="text-muted-foreground"> wishes to join </span>
                        <span className="text-primary">{r.family?.display_name}</span>
                      </div>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" className="h-6 px-1.5 text-elvish" onClick={() => resolveReq(r.id, true)}>
                          <Check className="w-3 h-3" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-6 px-1.5 text-destructive" onClick={() => resolveReq(r.id, false)}>
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'memberships' && (
            <div className="space-y-2">
              {memberships.length === 0 ? (
                <ServicePanelEmpty>You are not a member of any other families.</ServicePanelEmpty>
              ) : memberships.map(fam => (
                <div key={fam.id} className="surface-row p-2 rounded flex items-center justify-between text-xs">
                  <span className="font-display text-foreground flex items-center gap-1.5">
                    <Scroll className="w-3.5 h-3.5 text-primary/70" /> {fam.display_name}
                  </span>
                  <Button size="sm" variant="outline" onClick={() => leaveFamily(fam.id)}>Leave</Button>
                </div>
              ))}
            </div>
          )}

          {tab === 'requests' && (
            <div className="space-y-2">
              {outgoing.length === 0 ? (
                <ServicePanelEmpty>No pending requests.</ServicePanelEmpty>
              ) : outgoing.map(r => (
                <div key={r.id} className="surface-row p-2 rounded flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-primary font-display">{r.family?.display_name}</span>
                    <span className="text-muted-foreground"> — awaiting approval</span>
                  </span>
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-destructive" onClick={() => cancelReq(r.id)}>Cancel</Button>
                </div>
              ))}
            </div>
          )}
        </div>
      }
      singleColumn
    />
  );
}
