// M3 helper — route character HP/CP/MP updates through encounter delta RPCs
// so that concurrent tick / off-screen / heal writers cannot lose updates.
//
// The caller (combat-tick, etc.) still owns XP / level / stance / max_* PATCHes
// via `characters.update({...})` directly. This helper is only for the
// authoritative-resource half of the split.
//
// Modes come from readEncounterCharWritesMode(nodeId):
//   • off    — no-op; caller's legacy PATCH is the sole writer.
//   • shadow — legacy PATCH is authoritative; we fire *_dry_run RPCs in
//              parallel and log divergences.
//   • on     — RPCs are authoritative; caller MUST strip hp/cp/mp from its
//              PATCH payload so we don't double-write.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { readEncounterCharWritesMode, type EncounterFlagMode } from "./encounter-flag.ts";

export type CharResourceOp =
  | { field: "hp"; delta: number; expectedNew?: number; sourceCreatureId?: string | null }
  | { field: "cp"; delta: number; expectedNew?: number }
  | { field: "mp"; delta: number; expectedNew?: number };

export interface ApplyCharResourceOpsArgs {
  db: SupabaseClient;
  characterId: string;
  ops: CharResourceOp[];
  nodeId: string | null | undefined;
  sourceKind: string;
  modeOverride?: EncounterFlagMode;
}

export async function applyCharacterResourceOps(
  args: ApplyCharResourceOpsArgs,
): Promise<EncounterFlagMode> {
  const { db, characterId, ops, nodeId, sourceKind } = args;
  const mode = args.modeOverride ?? readEncounterCharWritesMode(nodeId);
  if (mode === "off" || ops.length === 0) return mode;

  await Promise.all(
    ops.map(async (op) => {
      try {
        if (op.field === "hp") {
          if (op.delta < 0) {
            const rpc = mode === "on"
              ? "encounter_apply_character_damage"
              : "encounter_apply_character_damage_dry_run";
            const body = mode === "on"
              ? {
                _character_id: characterId,
                _amount: -op.delta,
                _source_kind: sourceKind,
                _source_creature_id: op.sourceCreatureId ?? null,
              }
              : { _character_id: characterId, _amount: -op.delta };
            const { data, error } = await db.rpc(rpc, body);
            if (error) throw error;
            if (mode === "shadow" && op.expectedNew != null) {
              const row = Array.isArray(data) ? data[0] : data;
              const rpcNew = row?.new_hp;
              if (typeof rpcNew === "number" && rpcNew !== op.expectedNew) {
                console.warn(
                  `[encounter-char-writes] shadow hp divergence char=${characterId} legacy=${op.expectedNew} rpc=${rpcNew}`,
                );
              }
            }
          } else if (op.delta > 0) {
            const rpc = mode === "on"
              ? "encounter_apply_character_heal"
              : "encounter_apply_character_heal_dry_run";
            const body = mode === "on"
              ? { _character_id: characterId, _amount: op.delta, _source_kind: sourceKind }
              : { _character_id: characterId, _amount: op.delta };
            const { data, error } = await db.rpc(rpc, body);
            if (error) throw error;
            if (mode === "shadow" && op.expectedNew != null) {
              const row = Array.isArray(data) ? data[0] : data;
              const rpcNew = row?.new_hp;
              if (typeof rpcNew === "number" && rpcNew !== op.expectedNew) {
                console.warn(
                  `[encounter-char-writes] shadow hp-heal divergence char=${characterId} legacy=${op.expectedNew} rpc=${rpcNew}`,
                );
              }
            }
          }
        } else {
          // cp | mp
          const rpc = mode === "on"
            ? "encounter_apply_character_resource"
            : "encounter_apply_character_resource_dry_run";
          const body = mode === "on"
            ? {
              _character_id: characterId,
              _resource: op.field,
              _delta: op.delta,
              _source_kind: sourceKind,
            }
            : {
              _character_id: characterId,
              _resource: op.field,
              _delta: op.delta,
            };
          const { data, error } = await db.rpc(rpc, body);
          if (error) throw error;
          if (mode === "shadow" && op.expectedNew != null) {
            const row = Array.isArray(data) ? data[0] : data;
            const rpcNew = row?.new_value;
            if (typeof rpcNew === "number" && rpcNew !== op.expectedNew) {
              console.warn(
                `[encounter-char-writes] shadow ${op.field} divergence char=${characterId} legacy=${op.expectedNew} rpc=${rpcNew}`,
              );
            }
          }
        }
      } catch (e) {
        console.error(
          `[encounter-char-writes] ${mode} ${op.field} delta=${op.delta} char=${characterId}:`,
          e,
        );
      }
    }),
  );

  return mode;
}
