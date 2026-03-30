import { Party, PartyMember } from '@/hooks/useParty';
import { PlayerPresence } from '@/hooks/useNodeChannel';
import { Character } from '@/hooks/useCharacter';
import { Button } from '@/components/ui/button';
import { getCharacterTitle } from '@/lib/game-data';
import { Users, Crown, Shield, UserPlus, LogOut, X, Footprints, Crosshair } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import type { ActiveBuffs } from './MapPanel';

interface Props {
  character: Character;
  party: Party | null;
  members: PartyMember[];
  pendingInvites: { party_id: string; id: string; leader_name: string }[];
  isLeader: boolean;
  isTank: boolean;
  myMembership: PartyMember | undefined;
  playersHere: PlayerPresence[];
  onCreateParty: () => void;
  onInvite: (charId: string) => void;
  onAcceptInvite: (membershipId: string) => void;
  onDeclineInvite: (membershipId: string) => void;
  onLeave: () => void;
  onKick: (charId: string) => void;
  onSetTank: (charId: string | null) => void;
  onToggleFollow: (following: boolean) => void;
  activeBuffs?: ActiveBuffs;
  abilityTargetId?: string | null;
  onSetAbilityTarget?: (charId: string | null) => void;
  showTargetSelector?: boolean;
}

export default function PartyPanel({
  character, party, members, pendingInvites, isLeader, isTank: _isTank, myMembership,
  playersHere, onCreateParty, onInvite, onAcceptInvite, onDeclineInvite,
  onLeave, onKick, onSetTank, onToggleFollow, activeBuffs,
  abilityTargetId, onSetAbilityTarget, showTargetSelector,
}: Props) {
  // Players at same node who aren't in the party
  const invitablePlayers = playersHere.filter(
    p => p.id !== character.id && !members.some(m => m.character_id === p.id)
  );

  const BUFF_ICONS: { key: keyof ActiveBuffs; emoji: string; label: string; color: string }[] = [
    { key: 'focusStrike', emoji: '🎯', label: 'Focus Strike', color: 'text-primary' },
    { key: 'stealth', emoji: '🌑', label: 'Shadowstep', color: 'text-primary' },
    { key: 'damageBuff', emoji: '✨', label: 'Arcane Surge', color: 'text-elvish' },
    { key: 'acBuff', emoji: '📯', label: 'Battle Cry', color: 'text-dwarvish' },
    { key: 'poison', emoji: '🧪', label: 'Envenom', color: 'text-elvish' },
    { key: 'evasion', emoji: '🌫️', label: 'Evasion', color: 'text-primary' },
    { key: 'ignite', emoji: '🔥', label: 'Ignite', color: 'text-dwarvish' },
    { key: 'absorb', emoji: '🛡️✨', label: 'Force Shield', color: 'text-primary' },
    { key: 'root', emoji: '🌿', label: 'Entangle', color: 'text-elvish' },
    { key: 'sunder', emoji: '🔨', label: 'Sunder', color: 'text-dwarvish' },
  ];

  return (
    <TooltipProvider delayDuration={200}>
    <div className="space-y-2">
      <h3 className="font-display text-xs text-muted-foreground flex items-center gap-1">
        <Users className="w-3 h-3" /> Party
      </h3>

      {/* Pending invites */}
      {pendingInvites.map(inv => (
        <div key={inv.id} className="p-2 rounded border border-primary/50 bg-primary/5 text-xs space-y-1">
          <p className="text-foreground"><span className="text-primary font-display">{inv.leader_name}</span> invites you!</p>
          <div className="flex gap-1">
            <Button size="sm" variant="default" className="h-6 text-[10px]" onClick={() => onAcceptInvite(inv.id)}>Accept</Button>
            <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => onDeclineInvite(inv.id)}>Decline</Button>
          </div>
        </div>
      ))}

      {!party ? (
        <Button size="sm" variant="outline" className="w-full text-xs font-display" onClick={onCreateParty}>
          <Users className="w-3 h-3 mr-1" /> Create Party
        </Button>
      ) : (
        <div className="space-y-1.5">
          {/* Members list */}
          {members.map(m => {
            if (!m.character) return null;
            const isMe = m.character_id === character.id;
            const effectiveTankId = party.tank_id ?? party.leader_id;
            const isMemberTank = effectiveTankId === m.character_id;
            const isMemberLeader = party.leader_id === m.character_id;
            return (
              <div key={m.id} className="space-y-0.5">
                <div className="flex items-center justify-between p-1.5 rounded border border-border bg-background/30 text-xs">
                  <div className="flex items-center gap-1 truncate">
                    {isMemberLeader && <Crown className="w-3 h-3 text-primary shrink-0" />}
                    {isMemberTank && <Shield className="w-3 h-3 text-chart-2 shrink-0" />}
                    {m.is_following && <Footprints className="w-3 h-3 text-muted-foreground shrink-0" />}
                    <span className={`font-display truncate ${isMe ? 'text-primary' : 'text-foreground'}`}>
                      {m.character.name}
                    </span>
                    <span className="text-muted-foreground text-[10px]">L{m.character.level}</span>
                    {getCharacterTitle(m.character.level, m.character.gender) && (
                      <span className="text-[9px] text-primary/70 font-display tracking-wide uppercase">{getCharacterTitle(m.character.level, m.character.gender)}</span>
                    )}
                  </div>
                  <div className="flex gap-0.5 shrink-0">
                    {/* Ability target icon — shown for classes with targeted abilities */}
                    {showTargetSelector && !isMe && onSetAbilityTarget && (
                      <Button size="sm" variant="ghost" className="h-5 w-5 p-0" title="Set as ability target"
                        onClick={() => onSetAbilityTarget(abilityTargetId === m.character_id ? null : m.character_id)}>
                        <Crosshair className={`w-3 h-3 ${abilityTargetId === m.character_id ? 'text-elvish' : 'text-muted-foreground'}`} />
                      </Button>
                    )}
                    {isLeader && !isMe && (
                      <>
                        <Button size="sm" variant="ghost" className="h-5 w-5 p-0" title="Set as Tank"
                          onClick={() => onSetTank(isMemberTank ? null : m.character_id)}>
                          <Shield className={`w-3 h-3 ${isMemberTank ? 'text-chart-2' : 'text-muted-foreground'}`} />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-5 w-5 p-0" title="Kick"
                          onClick={() => onKick(m.character_id)}>
                          <X className="w-3 h-3 text-destructive" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                {/* Active buffs on the tank (only shown for "me" since buffs are local) */}
                {isMe && isMemberTank && activeBuffs && (() => {
                  const active = BUFF_ICONS.filter(b => activeBuffs[b.key]);
                  if (active.length === 0) return null;
                  return (
                    <div className="flex flex-wrap gap-0.5 pl-6">
                      {active.map(b => (
                        <Tooltip key={b.key}>
                          <TooltipTrigger asChild>
                            <span className={`text-[10px] ${b.color} cursor-default`}>{b.emoji}</span>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-xs">
                            {b.label}
                            {b.key === 'acBuff' && activeBuffs.acBuffBonus ? ` (AC+${activeBuffs.acBuffBonus})` : ''}
                            {b.key === 'absorb' && activeBuffs.absorbHp ? ` (${activeBuffs.absorbHp} HP)` : ''}
                          </TooltipContent>
                        </Tooltip>
                      ))}
                    </div>
                  );
                })()}
              </div>
            );
          })}

          {/* Follow toggle */}
          {!isLeader && myMembership && (
            <Button size="sm" variant={myMembership.is_following ? 'default' : 'outline'}
              className="w-full text-xs font-display h-7"
              onClick={() => onToggleFollow(!myMembership.is_following)}>
              <Footprints className="w-3 h-3 mr-1" />
              {myMembership.is_following ? 'Following Leader' : 'Follow Leader'}
            </Button>
          )}

          {/* Invite nearby players */}
          {isLeader && invitablePlayers.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground">Nearby:</p>
              {invitablePlayers.map(p => (
                <div key={p.id} className="flex items-center justify-between text-xs p-1 rounded border border-border/50">
                  <span className="text-elvish font-display truncate">{p.name}</span>
                  <Button size="sm" variant="ghost" className="h-5 p-0 px-1 text-[10px]"
                    onClick={() => onInvite(p.id)}>
                    <UserPlus className="w-3 h-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Leave / Disband */}
          <Button size="sm" variant="ghost" className="w-full text-xs text-destructive h-7"
            onClick={onLeave}>
            <LogOut className="w-3 h-3 mr-1" />
            {isLeader ? 'Disband Party' : 'Leave Party'}
          </Button>
        </div>
      )}
    </div>
    </TooltipProvider>
  );
}
