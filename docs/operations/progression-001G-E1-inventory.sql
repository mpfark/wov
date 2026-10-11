-- Prepared only: trusted read-only operator with visibility of private storage.
-- No RPCs, validators, role impersonation, private reasons or account identifiers.
-- If private visibility is unavailable, STOP: an empty result is not evidence.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT current_timestamp AS observed_at, current_user AS inspection_role;
-- One bounded row per current character, including soft-deleted characters.
SELECT c.id AS character_id, c.deleted_at IS NOT NULL AS soft_deleted,
 c.lifecycle_version, c.level, c.xp, c.class, c.is_classless,
 c.unspent_stat_points, c.respec_points, c.rp_total_earned,
 o.character_id IS NOT NULL AS has_origin,
 o.creation_version, o.race_version, o.class_version, o.formula_version,
 s.character_id IS NOT NULL AS has_progression_state, s.version,
 s.str_invested,s.dex_invested,s.con_invested,s.int_invested,s.wis_invested,s.cha_invested,
 (SELECT count(*) FROM public.character_creation_log l
   WHERE l.result_character_id=c.id AND l.replay_status='applied') AS applied_creation_records,
 (SELECT count(*) FROM public.progression_receipt r WHERE r.character_id=c.id) AS receipt_count,
 (SELECT count(*) FROM public.progression_respec_milestone m WHERE m.character_id=c.id) AS token_milestones,
 (SELECT count(*) FROM public.progression_class_growth_milestone m WHERE m.character_id=c.id) AS growth_milestones,
 (SELECT count(*) FROM public.character_lifecycle_receipt l WHERE l.character_id=c.id) AS lifecycle_receipts,
 -- Booleans indicate evidence to review, never automatic repair decisions.
 (c.level NOT BETWEEN 1 AND 42 OR c.xp<0
   OR (c.level=42 AND c.xp<>0) OR (c.level<42 AND c.xp>=50::bigint*c.level*c.level)
   OR c.is_classless IS DISTINCT FROM (c.class='classless')
   OR c.unspent_stat_points NOT BETWEEN 0 AND 200 OR c.respec_points<0) AS basic_state_flag,
 (s.version=0 AND EXISTS(SELECT 1 FROM public.progression_receipt r WHERE r.character_id=c.id)) AS zero_version_receipt_flag,
 (s.version>0 AND (SELECT count(*) FROM public.progression_receipt r
   WHERE r.character_id=c.id AND r.receipt->>'versionAfter'=s.version::text
     AND r.receipt->>'versionBefore'=(s.version-1)::text)<>1) AS latest_version_flag
FROM public.characters c
LEFT JOIN public.character_creation_origin o ON o.character_id=c.id
LEFT JOIN public.progression_character_state s ON s.character_id=c.id
ORDER BY c.id;
COMMIT;
