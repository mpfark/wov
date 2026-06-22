# Character Deletion: Truly Purge or Not?

**FK** stands for **Foreign Key**. It is a database constraint that links a column in one table (e.g. `character_id` in `character_inventory`) to a unique identifier in another table (the `id` in `characters`). This relationship ensures data integrity, but if it is not configured to "cascade" (automatically delete linked data when the parent is deleted), deletion will either fail or leave orphaned data behind.

Based on your preferences:
1. **Activity Log**: Hard-deleted along with the character.
2. **Marketplace Listings**: Hard-deleted along with the character (the escrowed item/gold is lost with the character).

---

## Technical Details

### 1. New DB migration — security-definer RPC `delete_character_cascade(_character_id uuid)`
We will create a single transactional database function to safely delete everything associated with a character in one go:

```sql
CREATE OR REPLACE FUNCTION public.delete_character_cascade(_character_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _user_id uuid;
BEGIN
    -- 1. Security Check: verify caller owns the character or is steward/overlord
    SELECT user_id INTO _user_id FROM public.characters WHERE id = _character_id;
    IF NOT (
        _user_id = auth.uid() 
        OR public.has_role(auth.uid(), 'steward') 
        OR public.has_role(auth.uid(), 'overlord')
    ) THEN
        RAISE EXCEPTION 'Not authorized';
    END IF;

    -- 2. Delete Marketplace Listings (hard-delete as requested)
    DELETE FROM public.marketplace_listings 
    WHERE seller_character_id = _character_id OR buyer_character_id = _character_id;

    -- 3. Delete active buffs/DoTs
    DELETE FROM public.active_effects 
    WHERE target_id = _character_id OR source_id = _character_id;

    -- 4. Delete map/character data in other tables
    DELETE FROM public.node_ground_loot WHERE dropped_by = _character_id;
    DELETE FROM public.character_visited_nodes WHERE character_id = _character_id;
    DELETE FROM public.character_class_bonds WHERE character_id = _character_id;
    DELETE FROM public.character_materials WHERE character_id = _character_id;
    DELETE FROM public.combat_sessions WHERE character_id = _character_id;
    DELETE FROM public.activity_log WHERE character_id = _character_id;
    DELETE FROM public.issue_reports WHERE character_id = _character_id;
    DELETE FROM public.character_inventory WHERE character_id = _character_id;
    DELETE FROM public.party_members WHERE character_id = _character_id;

    -- 5. Finally delete the character
    DELETE FROM public.characters WHERE id = _character_id;

    RETURN _character_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_character_cascade(uuid) TO authenticated;
```

### 2. Client change — `src/features/character/hooks/useCharacter.ts`
We will replace the sequential client-side deletion calls in `deleteCharacter`:
```ts
// Old client logic:
await supabase.from('character_inventory').delete().eq('character_id', id);
await supabase.from('party_members').delete().eq('character_id', id);
const { error } = await supabase.from('characters').delete().eq('id', id);

// New client logic:
const { error } = await supabase.rpc('delete_character_cascade', { _character_id: id });
```
This guarantees character deletion is single-transaction atomic and leaves zero orphan rows in the database.
