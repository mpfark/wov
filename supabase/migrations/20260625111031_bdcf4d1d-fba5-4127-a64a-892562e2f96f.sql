-- 1) Guard bhp_trained and family_* columns from direct client writes
CREATE OR REPLACE FUNCTION public.restrict_party_leader_updates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _stat_delta integer;
  _points_delta integer;
  _respec_delta integer;
  _trusted boolean;
BEGIN
  _trusted := coalesce(current_setting('app.trusted_rpc', true), '') = 'true';

  IF auth.uid() = NEW.user_id THEN
    NEW.level := OLD.level;
    NEW.xp := OLD.xp;
    NEW.user_id := OLD.user_id;

    IF NOT _trusted THEN
      NEW.race := OLD.race;
      NEW.class := OLD.class;
      NEW.is_classless := OLD.is_classless;
    END IF;

    IF OLD.soulforged_item_created = true THEN
      NEW.soulforged_item_created := true;
    END IF;

    IF NOT _trusted THEN
      NEW.soulring_tier := OLD.soulring_tier;
      NEW.soulring_inventory_id := OLD.soulring_inventory_id;
      NEW.king_slayer_at := OLD.king_slayer_at;
    END IF;

    IF NEW.gold > OLD.gold AND NOT _trusted THEN
      NEW.gold := OLD.gold;
    END IF;

    IF NOT _trusted THEN
      NEW.max_hp := OLD.max_hp;
      NEW.max_cp := OLD.max_cp;
      NEW.max_mp := OLD.max_mp;
      NEW.ac := OLD.ac;

      NEW.hp := LEAST(GREATEST(COALESCE(NEW.hp, 0), 0), OLD.max_hp);
      NEW.mp := LEAST(GREATEST(COALESCE(NEW.mp, 0), 0), OLD.max_mp);
      NEW.cp := LEAST(GREATEST(COALESCE(NEW.cp, 0), 0), OLD.max_cp);

      NEW.reserved_buffs := OLD.reserved_buffs;
      NEW.stance_state := OLD.stance_state;

      -- BHP training history is server-RPC-only.
      NEW.bhp_trained := OLD.bhp_trained;

      -- Family association is mutated only via SECURITY DEFINER RPCs.
      NEW.family_id := OLD.family_id;
      NEW.family_name := OLD.family_name;
      NEW.family_changed_after_creation := OLD.family_changed_after_creation;
    END IF;

    IF NEW.bhp > OLD.bhp THEN
      NEW.bhp := OLD.bhp;
    END IF;

    IF NEW.rp_total_earned > OLD.rp_total_earned THEN
      NEW.rp_total_earned := OLD.rp_total_earned;
    END IF;

    IF NEW.respec_points > OLD.respec_points THEN
      NEW.respec_points := OLD.respec_points;
    END IF;

    _stat_delta := (NEW.str - OLD.str) + (NEW.dex - OLD.dex) + (NEW.con - OLD.con)
                 + (NEW.int - OLD.int) + (NEW.wis - OLD.wis) + (NEW.cha - OLD.cha);
    _points_delta := OLD.unspent_stat_points - NEW.unspent_stat_points;
    _respec_delta := OLD.respec_points - NEW.respec_points;

    IF _respec_delta <= 0 THEN
      IF _stat_delta > 0 AND _stat_delta != _points_delta THEN
        NEW.str := OLD.str;
        NEW.dex := OLD.dex;
        NEW.con := OLD.con;
        NEW.int := OLD.int;
        NEW.wis := OLD.wis;
        NEW.cha := OLD.cha;
        NEW.unspent_stat_points := OLD.unspent_stat_points;
      END IF;
      IF NEW.unspent_stat_points > OLD.unspent_stat_points THEN
        NEW.unspent_stat_points := OLD.unspent_stat_points;
      END IF;
    END IF;

    NEW.gold := GREATEST(NEW.gold, 0);
    NEW.ac := LEAST(GREATEST(NEW.ac, 1), 100);
    NEW.max_hp := LEAST(GREATEST(NEW.max_hp, 1), 10000);
    NEW.max_cp := LEAST(GREATEST(NEW.max_cp, 0), 5000);
  END IF;

  RETURN NEW;
END;
$function$;

-- 2) Restrict families SELECT so pending requesters cannot read founder_user_id.
DROP POLICY IF EXISTS "Founders members and requesters can view family" ON public.families;
CREATE POLICY "Founders and members can view family"
  ON public.families
  FOR SELECT
  TO authenticated
  USING (
    founder_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.family_members fm
      WHERE fm.family_id = families.id AND fm.user_id = auth.uid()
    )
  );

-- 3) Allow a player to read their own combat_sessions rows (server still authoritative via service role).
CREATE POLICY "Players read their own combat sessions"
  ON public.combat_sessions
  FOR SELECT
  TO authenticated
  USING (public.owns_character(character_id));
