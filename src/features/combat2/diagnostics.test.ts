import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCombat2DiagnosticExport, clearCombat2Recording, COMBAT2_DIAGNOSTIC_MAX_EVENTS,
  currentCombat2Recording, exportCombat2ServerRecording, recordCombat2ClientEvent, startCombat2Recording,
  startCombat2ServerRecording, stopCombat2ServerRecording } from './diagnostics';

describe('Combat2 bounded diagnostics', () => {
  beforeEach(() => { sessionStorage.clear(); vi.restoreAllMocks(); });
  it('is disabled by default and uses monotonic client timestamps', () => {
    expect(currentCombat2Recording()).toBeNull();
    vi.spyOn(Date, 'now').mockReturnValue(1001);
    vi.spyOn(performance, 'now').mockReturnValue(42);
    startCombat2Recording('character', 'node', 'encounter', 1000);
    recordCombat2ClientEvent({ event: 'action_clicked', requestId: 'request' });
    expect(currentCombat2Recording(1001)?.events[0]).toMatchObject({ side: 'client', monotonicMs: 42 });
  });
  it('bounds duration and event count', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1001);
    startCombat2Recording('character', null, null, 1000);
    for (let i=0;i<COMBAT2_DIAGNOSTIC_MAX_EVENTS+3;i++) recordCombat2ClientEvent({ event:`e${i}` });
    expect(currentCombat2Recording(1001)).toMatchObject({ dropped: 3, events: { length: COMBAT2_DIAGNOSTIC_MAX_EVENTS } });
    expect(currentCombat2Recording(301001)).toBeNull();
  });
  it('correlates without pretending clocks are synchronized and reports gaps and duplicates', () => {
    const recording=startCombat2Recording('character','node','encounter',1000);
    recording.events=[{side:'client',event:'sent',wallTime:'2099-01-01T00:00:00Z',requestId:'same'},
      {side:'client',event:'missing-server',wallTime:'2099-01-01T00:00:01Z',requestId:'client-only'}];
    const out=buildCombat2DiagnosticExport(recording,[{side:'server',event:'accepted',wallTime:'2000-01-01T00:00:00Z',requestId:'same'},
      {side:'server',event:'duplicate',wallTime:'2000-01-01T00:00:01Z',requestId:'same'}]);
    expect(out.metadata.note).toContain('independent');
    expect(out.unmatchedClientEvents).toHaveLength(1);
    expect(out.summaryStatistics.duplicateCorrelationIds).toContain('same');
    clearCombat2Recording();
  });
  it('uses the authoritative server session id and exports separate original streams',async()=>{
    const rpc=vi.fn(async(name:string)=>name==='combat2_diagnostic_start'
      ?{data:{ok:true,kind:'started',session_id:'server-session'},error:null}
      :name==='combat2_diagnostic_stop'?{data:{ok:true,kind:'stopped'},error:null}
      :{data:{ok:true,kind:'exported',events:[{event_type:'claim_acquired',occurred_at:'2026-09-21T00:00:00Z',node_id:'node',tick:1,elapsed_ms:2}]},error:null});
    const recording=await startCombat2ServerRecording({rpc},'character','node','encounter');
    expect(recording.sessionId).toBe('server-session');
    recordCombat2ClientEvent({event:'notification_received',encounterId:'encounter',tick:1});
    const exported=await exportCombat2ServerRecording({rpc},currentCombat2Recording()!);
    expect(exported.clientEvents).toHaveLength(1);expect(exported.serverEvents).toHaveLength(1);
    expect(exported.correlatedTimeline).toHaveLength(2);
    await stopCombat2ServerRecording({rpc},recording.sessionId); expect(currentCombat2Recording()).toBeNull();
  });
});
