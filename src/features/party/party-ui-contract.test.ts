import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';
const PANEL=readFileSync('src/features/party/components/PartyPanel.tsx','utf8');
const PAGE=readFileSync('src/pages/GamePage.tsx','utf8');
const HOOK=readFileSync('src/features/party/hooks/useParty.ts','utf8');
describe('real party UI authority',()=>{
 it('shows structured operation status and leader cancellation controls',()=>{expect(PANEL).toContain('operationMessage');expect(PANEL).toContain('role="status"');expect(PANEL).toContain('outgoingInvites.map');expect(PANEL).toContain('onCancelInvite(inv.id)');});
 it('routes party actions without the Combat2 legacy-execution guard',()=>{expect(PAGE).toContain('createParty, invitePlayer, acceptInvite, declineInvite, cancelInvite');expect(PAGE).not.toContain('legacyCreateParty');expect(PAGE).not.toContain('legacyInvitePlayer');expect(PAGE).not.toContain('legacyAcceptInvite');});
 it('routes follow consent through party_mutate and performs no direct party mutation',()=>{expect(HOOK).toContain("following?'follow':'stop_following'");expect(HOOK).not.toMatch(/\.from\(['"](?:parties|party_members)['"]\)/);expect(HOOK).not.toContain('accept_party_invite');expect(HOOK).not.toContain('set_party_tank');});
});
