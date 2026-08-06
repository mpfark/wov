CREATE TABLE public.base_abilities (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  base_key text NOT NULL UNIQUE,
  label text NOT NULL,
  description text NOT NULL DEFAULT '',
  mechanic_key text NOT NULL,
  activation_mode text NOT NULL DEFAULT 'instant',
  default_target_type text NOT NULL DEFAULT 'enemy',
  allowed_target_types text[] NOT NULL DEFAULT ARRAY['enemy']::text[],
  trigger_type text NOT NULL DEFAULT 'none',
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  on_hit_allowed text[] NOT NULL DEFAULT ARRAY[]::text[],
  status text NOT NULL DEFAULT 'active',
  admin_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT base_abilities_trigger_type_chk CHECK (trigger_type IN ('none','on_hit','pulse'))
);

GRANT SELECT ON public.base_abilities TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.base_abilities TO authenticated;
GRANT ALL ON public.base_abilities TO service_role;

ALTER TABLE public.base_abilities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Base abilities are readable by everyone"
  ON public.base_abilities FOR SELECT USING (true);

CREATE POLICY "Stewards manage base abilities"
  ON public.base_abilities FOR ALL TO authenticated
  USING (public.is_steward_or_overlord())
  WITH CHECK (public.is_steward_or_overlord());

CREATE TRIGGER trg_base_abilities_updated_at
  BEFORE UPDATE ON public.base_abilities
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

INSERT INTO public.base_abilities
  (base_key, label, description, mechanic_key, activation_mode, default_target_type, allowed_target_types, trigger_type, capabilities, on_hit_allowed, admin_notes)
VALUES
  ('weapon_attack','Weapon Attack','Weapon-scaled strike against one enemy. Class abilities supply name, wording, scaling attribute and damage type.','weapon_attack','instant','enemy',ARRAY['enemy'],'none','["identity","activation","damage","scaling","damage_type","amount","combat_text","on_hit_effect"]','{bleed,poison}',NULL),
  ('spell_attack','Spell Attack','Calculated spell damage against one enemy with configurable damage type and casting attribute.','spell_attack','instant','enemy',ARRAY['enemy'],'none','["identity","activation","damage","scaling","damage_type","amount","combat_text","on_hit_effect"]','{ignite,bleed,poison}',NULL),
  ('multi_attack','Multi Attack','Several weapon-scaled attacks in one activation; the count comes from a configured calc.','multi_attack','queued','enemy',ARRAY['enemy'],'none','["identity","activation","damage","scaling","damage_type","amount","combat_text","on_hit_effect"]','{bleed,poison}',NULL),
  ('burst_damage','Burst Damage','Single large finisher hit with a configurable crit edge.','burst_damage','queued','enemy',ARRAY['enemy'],'none','["identity","activation","damage","scaling","damage_type","amount","combat_text"]','{}',NULL),
  ('stack_consume','Stack Finisher','Consumes accumulated enemy stacks of a configured status for bonus damage.','stack_consume','instant','enemy',ARRAY['enemy'],'none','["identity","activation","damage","scaling","damage_type","amount","applied_status","combat_text"]','{}',NULL),
  ('on_hit_stance','On-Hit Stance','Persistent self-stance. Subsequent WEAPON hits apply a configured status to the enemy.','stack_apply','stance','self',ARRAY['self'],'on_hit','["identity","activation","stance","applied_status","scaling","duration","amount","combat_text"]','{poison,bleed,ignite}','Self-activated stance; the status lands on the enemy on weapon hits. Not a directly cast debuff.'),
  ('orb_stance','Orb Stance','Persistent self-stance that performs its own automatic attacks against the current enemy and applies a configured status when they hit.','stack_apply','stance','self',ARRAY['self'],'pulse','["identity","activation","stance","applied_status","scaling","duration","interval","amount","damage_type","combat_text"]','{ignite,bleed,poison}','Self-activated stance with automatic attacks. The applied status is the enemy-side effect, never a selectable ability.'),
  ('dot_debuff','Damage Over Time','Applies a ticking damage status to one enemy.','dot_debuff','instant','enemy',ARRAY['enemy'],'none','["identity","activation","damage","scaling","damage_type","amount","duration","applied_status","combat_text"]','{}',NULL),
  ('control_debuff','Control Debuff','Weakens one enemy (damage or armour reduction) for a configured duration.','control_debuff','instant','enemy',ARRAY['enemy'],'none','["identity","activation","scaling","damage_type","amount","duration","combat_text"]','{}',NULL),
  ('aura_pulse','Aura Pulse','Node-wide pulse that can damage enemies and heal allies over time.','aura_pulse','instant','node',ARRAY['node'],'none','["identity","activation","scaling","damage_type","amount","duration","interval","combat_text"]','{}',NULL),
  ('heal','Heal','Restores health to the caster or one ally.','heal','instant','self',ARRAY['self','ally'],'none','["identity","activation","scaling","amount","combat_text"]','{}',NULL),
  ('hp_transfer','Health Transfer','Moves health from the caster to an ally, keeping a safety reserve.','hp_transfer','instant','ally',ARRAY['ally'],'none','["identity","activation","scaling","amount","combat_text"]','{}',NULL),
  ('party_regen','Party Regeneration','Timed regeneration applied to the whole party.','party_regen','instant','party',ARRAY['party'],'none','["identity","activation","scaling","amount","duration","interval","combat_text"]','{}',NULL),
  ('regen_buff','Regeneration Buff','Timed self or ally regeneration buff.','regen_buff','instant','self',ARRAY['self','ally','party'],'none','["identity","activation","scaling","amount","duration","interval","combat_text"]','{}',NULL),
  ('absorb_buff','Absorb Shield','Grants an absorbing shield to the caster or an ally.','absorb_buff','instant','self',ARRAY['self','ally'],'none','["identity","activation","scaling","amount","duration","combat_text"]','{}',NULL),
  ('mitigation_buff','Mitigation Buff','Reduces incoming damage by a percentage or flat amount, optionally taunting.','mitigation_buff','stance','self',ARRAY['self'],'none','["identity","activation","stance","scaling","amount","duration","combat_text"]','{}',NULL),
  ('block_buff','Block Stance','Self-stance granting a chance to block incoming attacks.','block_buff','stance','self',ARRAY['self'],'none','["identity","activation","stance","scaling","amount","combat_text"]','{}',NULL),
  ('reactive_holy','Reactive Retaliation','Self-buff that retaliates against attackers.','reactive_holy','instant','self',ARRAY['self'],'none','["identity","activation","scaling","damage_type","amount","duration","combat_text"]','{}',NULL),
  ('offense_buff','Offensive Buff','Self-stance increasing damage output or crit edge.','offense_buff','stance','self',ARRAY['self'],'none','["identity","activation","stance","scaling","amount","duration","combat_text"]','{}',NULL),
  ('evasion_buff','Evasion Buff','Self-buff granting dodge or evasion for a window.','evasion_buff','instant','self',ARRAY['self'],'none','["identity","activation","scaling","amount","duration","combat_text"]','{}',NULL),
  ('stealth_buff','Stealth Opener','Self-buff granting stealth and an ambush multiplier on the next strike.','stealth_buff','instant','self',ARRAY['self'],'none','["identity","activation","scaling","amount","duration","combat_text"]','{}',NULL);

ALTER TABLE public.abilities
  ADD COLUMN base_ability_id uuid REFERENCES public.base_abilities(id);

UPDATE public.abilities a
SET base_ability_id = b.id
FROM public.base_abilities b
WHERE b.mechanic_key = a.mechanic_key
  AND b.base_key NOT IN ('on_hit_stance','orb_stance');

UPDATE public.abilities a
SET base_ability_id = b.id
FROM public.base_abilities b
WHERE a.mechanic_key = 'stack_apply'
  AND b.base_key = CASE
    WHEN coalesce(a.effect_config->>'trigger', CASE WHEN a.ability_key = 'ignite' THEN 'pulse' ELSE 'on_hit' END) = 'pulse'
      THEN 'orb_stance' ELSE 'on_hit_stance' END;

ALTER TABLE public.abilities ALTER COLUMN base_ability_id SET NOT NULL;

CREATE OR REPLACE FUNCTION public.guard_ability_base_mechanic()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _base_mechanic text;
BEGIN
  SELECT mechanic_key INTO _base_mechanic
  FROM public.base_abilities WHERE id = NEW.base_ability_id;
  IF _base_mechanic IS NULL THEN
    RAISE EXCEPTION 'base_ability_id % does not exist', NEW.base_ability_id;
  END IF;
  IF _base_mechanic <> NEW.mechanic_key THEN
    RAISE EXCEPTION 'ability mechanic_key (%) must match its base ability mechanic (%)',
      NEW.mechanic_key, _base_mechanic;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_abilities_base_mechanic
  BEFORE INSERT OR UPDATE OF mechanic_key, base_ability_id ON public.abilities
  FOR EACH ROW EXECUTE FUNCTION public.guard_ability_base_mechanic();