import {readFileSync} from 'node:fs';import{describe,it,expect}from'vitest';
const S=readFileSync('src/components/admin/CreatureManager.tsx','utf8');
describe('Creature Manager authoritative rewards',()=>{
 it('shows independent channels and four exclusive sources',()=>{expect(S).toContain('checked={form.gold_enabled}');expect(S).toContain('checked={form.salvage_enabled}');for(const v of ['none','world_pool','assigned_table','unique_boss_drop'])expect(S).toContain(`value="${v}"`);});
 it('does not expose legacy inline modes or humanoid-derived reward writes',()=>{expect(S).not.toContain('Per-item loot (individual chance per item)');expect(S).not.toContain('<ItemPickerList');expect(S).not.toContain('Loot Mode:');expect(S).not.toContain('calculateHumanoidGold');});
 it('uses only the authoritative RPC with replay and response validation',()=>{expect(S).toContain("rpc('admin_set_creature_rewards'");expect(S).toContain('rewardRequestRef.current?.key');expect(S).toContain('decodeRewardMutationResult(data)');expect(S).toContain("row.ok === true && row.kind === 'updated'");});
 it('explains unique theft and fixed salvage',()=>{expect(S).toContain('may be stolen');expect(S).toContain('1 / 2 / 4');});
 it('shows only source-relevant controls and rejects invalid local combinations',()=>{expect(S).toContain("form.item_source==='world_pool'");expect(S).toContain("form.item_source==='assigned_table'");expect(S).toContain("form.item_source==='unique_boss_drop'");expect(S).toContain('Unique boss drops require boss rarity.');expect(S).toContain('Gold maximum must be at least the minimum.');});
});
