# ENG-ABILITY-WIZARD-001B — necessary balance follow-up

Source main: `b696ddb5bbc7a48e33f161e02bdf5d9d97bc3b28`, GitHub branch verified2026-10-27. Analysis model only; no runtime/catalogue/SQL mutation. This appendix preserves the relevant ENG-ABILITY-WIZARD-001A chat assumptions and changes only consumption, the two Orb damage candidates and approved stance costs/reservations. It does not repeat the earlier engine audit. [Target design and approval status](../design/wizard-redesign.md).

## Model and limitations

The 001A model used L20 INT/WIS26/26,35/17,16/36 and L40 43/43,62/24,23/63. These are conservative no-gear Elf progression scenarios, early Wizard membership assumed, with the documented class-growth reference and discretionary investment; not observed characters or hosted class-row proof. Stress100/100,150/10,10/150 at L40 are intentionally extreme, not claimed feasible owned loadouts.

Retain15 action opportunities at2,4,...,30seconds, even-tick WIS/milestone CP regeneration and DEX10/natural20 crits. Generator regular AC24 at L20 and AC35 at L40 are **synthetic benchmarks**, not actual world-creature measurements. HP is unlimited; no survival, kill clipping, basic attacks, item procs or other players. An isolated Surge benchmark uses direct spells without riders. Fire has empty Ignite at start, ticks before action, independent Orbs after action, Conflagrate attempted on ticks5/10/15 and Fireball otherwise. An unaffordable planned action is skipped, not replaced or delayed; no optimal-rotation claim.

Ignite35% Fireball application, maximum5 owned stacks, full per-stack `2+floor(.25*w)`, Conflagrate30CP/+30% per stack, existing spell/burst profiles and Orb chance remain unchanged. A retained30–45second Ignite duration cannot expire an applied group before its useful pulses in this empty-start30second window; this model does not establish the final duration or long-fight refresh balance. Direct hit bands, rounding, critical bonus and grazing cap3 are retained. Orb procs have no d20/crit/grazing; they apply a stack and direct damage.

All new comparisons use60,000 trials/cell, LCG seed15401 (1664525,1013904223), three draws per tick regardless of branch. Common random draws isolate the policy change instead of confusing it with Monte Carlo noise. Maximum damage-mean standard error across these cases is1.32. The same-policy repeat of001A differs slightly from its chat values because sampling streams differ, not because the formula changed; use paired columns below for deltas. This is a separate numerical model, not execution of Combat2 or integration-test evidence. The intended two-second cadence is not a fresh measurement of deployed scheduler timing.

## Conflagrate and Orb comparison: prepared stances, recovered full raw CP

Stances are already active and raw CP is full before the measured window; paid historical activation is outside it. Orbs reserves the approved fixed20CP. CP column is ability expenditure only; reservation remains locked. Compare A -> B for consumption; B -> C for soft Orb damage.

- A:001A-style consumption even on miss, current linear Orb damage.
- B:approved consumption only on landed hit (including grazing), current linear Orb damage.
- C:landed-only consumption plus proposed reuse of existing damage-soft profile for Orbs.

| Level / profile INT/WIS | A damage | B damage | C damage | CP each | Orb damage linear / soft |
|---|---:|---:|---:|---:|---:|
| 20 Balanced 26/26 | 403.8 | 414.3 | 414.3 | 160 | 10 / 10 |
| 20 INT-heavy 35/17 | 501.2 | 502.6 | 502.6 | 140 | 14 / 14 |
| 20 WIS-heavy 16/36 | 273.7 | 297.6 | 297.6 | 170 | 5 / 5 |
| 40 Balanced 43/43 | 947.5 | 956.2 | 956.2 | 210 | 18 / 18 |
| 40 INT-heavy 62/24 | 1188.4 | 1193.8 | 1166.6 | 210 | 28 / 24 |
| 40 WIS-heavy 23/63 | 523.3 | 563.6 | 563.6 | 210 | 8 / 8 |
| 40 Stress 100/100 | 2006.7 | 2024.3 | 1919.3 | 210 | 47 / 33 |
| 40 Stress 150/10 | 2208.4 | 2213.8 | 2003.8 | 210 | 72 / 44 |
| 40 Stress 10/150 | 449.2 | 590.1 | 590.1 | 210 | 2 / 2 |

Preserving stacks improves WIS-heavy40 by40.25 damage, about7.7%; extreme10/150 improves140.85, about31.4%. Ordinary INT-heavy40 gains only5.47. The primary change is retained future DoT, not a large new finisher coefficient.

Soft Orbs do not change modifiers<=20. At INT62 the successful proc changes28->24 and total B->C falls27.23 (about2.3%); at INT100 it changes47->33 and total falls105.00 (5.2%); INT150 changes72->44 and total falls209.99 (9.5%). **Owner-approved first implementation baseline2026-10-27: C**, preserving the existing damage curve without a new cap, with landed-only Conflagrate consumption. Owner also confirms the existing WIS-based Ignite duration `min(45,30+w)` seconds and the corrected 001B coefficients. Later tuning must be test/gameplay-based. High INT still wins these solo benchmarks; this is not a global attribute repair. A/B remain comparison evidence only, not alternative approved runtime contracts.

## Arcane Surge fixed reservation correction

Surge now reserves15 rather than001A's model20. Activation15 is paid before the recovered-pool window, so it is excluded here. No alteration to the authored multiplier or its direct-only scope.

| Level / profile | Damage / ability CP | Direct casts | Final raw CP |
|---|---:|---:|---:|
| 20 Balanced 26/26 | 334.2 / 150 | 15 | 34 |
| 20 INT-heavy 35/17 | 471.4 / 150 | 15 | 17 |
| 20 WIS-heavy 16/36 | 173.8 / 150 | 15 | 41 |
| 40 Balanced 43/43 | 676.7 / 150 | 15 | 175 |
| 40 INT-heavy 62/24 | 933.8 / 150 | 15 | 166 |
| 40 WIS-heavy 23/63 | 302.7 / 150 | 15 | 187 |

L20 INT-heavy changes from001A's roughly440/140CP and14casts to471/150CP and15casts. Other listed profiles retain their cast counts; small differences are sampling noise. Damage scope remains direct attacks, not DoT/Orbs/item procs. At L40 the larger pool prevents this reservation change from affecting the15-cast sequence.

Frost+Grasp and Focus+Overload recovered-pool formulas/reservations are unchanged from001A; no repeat broad simulation is necessary. For reference001A Frost damage/CP was L20 balanced350/180, INT-heavy440/160, WIS-heavy188/180; L40 balanced699/180, INT-heavy939/180, WIS-heavy318/180. Grasp's +12% is separate from shared Chilled +2%; at five stacks the pre-rounding combination is1.60*1.10=1.76. No Frost calibration change is proposed.

## Activation charged immediately before combat, without recovery

This sensitivity starts from full pre-activation raw CP, activates the one tested stance immediately before the first attack window, charges the approved price and keeps its reservation. Activation is outside the15 combat action opportunities; activating during an encounter instead consumes the existing stance action slot and is not modelled here. No defensive stance is activated in either scenario; if selected and activated it costs another10CP and reserves10.

Cells: **damage / total CP including activation (direct action count)**. Fire uses candidate C, Orbs20activation/20reservation. Surge uses15/15. Overload uses Focus15/15; base25 after Focus plus automatic extra<=30; direct5CP filler if Overload base is unaffordable. Extra is never discounted.

| Level / profile | Fire | Surge | Focus + Overload |
|---|---:|---:|---:|
| 20 Balanced 26/26 | 447.3 / 160 (12) | 334.2 / 165 (15) | 275.8 / 165 (10) |
| 20 INT-heavy 35/17 | 447.3 / 140 (10) | 408.4 / 145 (13) | 309.3 / 152 (8) |
| 20 WIS-heavy 16/36 | 341.5 / 170 (13) | 173.8 / 165 (15) | 187.0 / 175 (12) |
| 40 Balanced 43/43 | 956.2 / 230 (15) | 676.7 / 165 (15) | 762.5 / 306 (14) |
| 40 INT-heavy 62/24 | 1166.6 / 230 (15) | 933.8 / 165 (15) | 1011.5 / 290 (15) |
| 40 WIS-heavy 23/63 | 563.6 / 230 (15) | 302.7 / 165 (15) | 382.6 / 326 (13) |

At low CP, the fixed rotation can skip a30CP Conflagrate and keep stacks ticking, making charged-start Fire damage exceed recovered-start damage despite fewer resources. Greedy Overload/filler timing can likewise shift discontinuously. These are explicit benchmark scheduling effects, not evidence that activation increases damage, that spending CP is beneficial, or that this rotation is optimal. Do not retune coefficients from those inversions. Actual affordability/rotation policy needs targeted implementation acceptance, not a new gameplay rule.

## Sources and local check boundary

- [Combat2 hit/amount handlers](../../src/shared/combat2/mechanics.ts), [effects/CP/Orbs/consumption](../../src/shared/combat2/resolver.ts), [hit formulas](../../src/shared/formulas/combat.ts), [profiles](../../src/shared/formulas/effective.ts), [CP/milestones](../../src/shared/formulas/resources.ts).
- [Published baseline](../../src/shared/combat/inventory/active-abilities.json), [creation inputs](../design/progression-001G-C2-P2-A-creation-manifest.md), [growth fixture](../../src/shared/progression/golden-vectors.ts).
- [Generator](../../src/shared/formulas/creatures.ts) and [explicit arena seeds](../../supabase/migrations/20260906001238_8c52869c-2e3d-4602-aa5a-96ea750f63d6.sql): seedL5 HP80/AC8 andL20 HP400/AC14 are test content, not representative world balance. No verified representative L40 roster or item loadout was obtained. No game Cloud/Supabase access was performed.

Numeric checks: same-policy A repeats001A within sampling differences; B/C have identical CP/casts/proc/DoT/finisher draws and differ only in successful Orb magnitudes; C equals B through modifier20. CP ledger obeys maxCP + applied regen - expenditure = finalCP, with regeneration clamped to maxCP; reservations are not counted as expenditure. Nonlinear skipped-action effects are recorded rather than hidden.

## Reproducible standalone analysis model

Run the following JavaScript in an independent Node process or REPL; it writes no files, imports no application runtime and requires no network. `simulate(...,'fire',false,false)` is A; `true,false` is B; `true,true` is C. The last boolean selects charged activation; default is recovered pool. This is documentation of the analysis, not a new shipped script or engine consumer.

```javascript
const soft=(m,c,r)=>m<=c?m:c+(m-c)*r;
function simulate(L,I,W,path,consumeOnHit=true,softOrb=false,cold=false,N=60000) {
 let seed=15401;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};
 const i=Math.floor((I-10)/2),w=Math.floor((W-10)/2),ac=Math.round(12+.575*L);
 const maxcp=30+3*(L-1)+3*(Math.max(0,i)+Math.max(0,w));
 const regen=2+Math.floor(Math.sqrt(Math.max(0,W-10)))+(L>=40?5:L>=20?1:0);
 const reserve=path==='fire'?20:15,activation=path==='fire'?20:15;
 const fb=5+Math.round(2*soft(Math.max(0,i),20,.45))+Math.floor(L/3);
 const con=4+Math.round(2*soft(Math.max(0,i),18,.4))+Math.floor(L/3);
 const orbP=.25+Math.min(.25,.04*Math.sqrt(Math.max(0,i)));
 const orbD=softOrb?Math.max(1,Math.floor(2+soft(i,20,.45))):Math.max(1,2+i);
 const dot=2+Math.floor(.25*Math.max(0,w));
 const surge=1.1+Math.min(.12,.02*Math.sqrt(Math.max(0,i)));
 let sums={damage:0,cp:0,casts:0,dot:0,orbs:0,con:0,finalCP:0},sq=0;
 function hit(base,r,mult=1){
  let margin=r+2+Math.floor(L/2)+(i<0?i:Math.min(8,Math.floor(1.5*Math.sqrt(i))))-ac;
  let crit=r>=20,q=r===1?0:crit?(margin>=7?1.25:1):margin< -5?0:margin<0?.25:margin<=2?.6:margin<=6?1:1.25;
  if(!q)return [0,false];let n=Math.max(1,Math.floor(base*mult*q));let d=n+(crit?Math.floor(n*.5):0);
  return [q===.25?Math.min(3,d):d,true];
 }
 for(let run=0;run<N;run++){
  let cp=maxcp-(cold?activation:0),stacks=0,dmg=0,spent=cold?activation:0,casts=0,dd=0,od=0,cd=0;
  for(let t=1;t<=15;t++){
   let roll=1+Math.floor(rnd()*20),proc=rnd(),orb=rnd();
   if(path==='fire'){let d=stacks*dot;dmg+=d;dd+=d;}
   if(t%2===0)cp=Math.min(maxcp,cp+regen);
   let available=cp-reserve,cost=10,base=fb,kind='fb';
   if(path==='fire'&&t%5===0){cost=30;base=con*(1+.30*stacks);kind='con';}
   if(path==='overload'){
    cost=25;if(available>=25){let extra=Math.min(30,Math.floor(available-25));cost+=extra;base=12+Math.round(3*soft(Math.max(0,i),18,.4))+Math.floor(L/3)+1.5*extra;}
    else {cost=5;kind='filler';}
   }
   if(available>=cost){
    cp-=cost;spent+=cost;casts++;
    let [d,landed]=hit(base,roll,path==='surge'?surge:1);dmg+=d;
    if(kind==='con'){cd+=d;if(landed||!consumeOnHit)stacks=0;}
    if(path==='fire'&&kind==='fb'&&landed&&proc<.35)stacks=Math.min(5,stacks+1);
   }
   if(path==='fire'&&orb<orbP){dmg+=orbD;od+=orbD;stacks=Math.min(5,stacks+1);}
  }
  let vals={damage:dmg,cp:spent,casts,dot:dd,orbs:od,con:cd,finalCP:cp};
  for(let k in sums)sums[k]+=vals[k];sq+=dmg*dmg;
 }
 let out={L,I,W,path,consumeOnHit,softOrb,cold,N,maxcp,regen,reserve,activation,orbDamage:orbD};
 for(let k in sums)out[k]=+(sums[k]/N).toFixed(2);
 out.SE=+Math.sqrt((sq/N-(sums.damage/N)**2)/N).toFixed(3);return out;
}
for (const [L,I,W] of [
  [20,26,26],[20,35,17],[20,16,36],
  [40,43,43],[40,62,24],[40,23,63],
  [40,100,100],[40,150,10],[40,10,150]
]) {
  for (const [consume,softOrb] of [[false,false],[true,false],[true,true]])
    console.log(simulate(L,I,W,'fire',consume,softOrb));
  console.log(simulate(L,I,W,'surge'));
  for (const path of ['fire','surge','overload'])
    console.log(simulate(L,I,W,path,true,path==='fire',true));
}
```
