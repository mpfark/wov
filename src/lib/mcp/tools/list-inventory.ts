import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_inventory",
  title: "List inventory",
  description:
    "List the equipment and inventory of one of the signed-in player's characters, including rarity, slot, durability and equipped state.",
  inputSchema: {
    character_name: z.string().trim().min(1).describe("Character's first name."),
    equipped_only: z.boolean().optional().describe("When true, only return equipped items."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ character_name, equipped_only }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data: character, error: charError } = await supabase
      .from("characters")
      .select("id, name")
      .ilike("name", character_name)
      .maybeSingle();

    if (charError) {
      return { content: [{ type: "text", text: charError.message }], isError: true };
    }
    if (!character) {
      return {
        content: [{ type: "text", text: `No character named "${character_name}" on this account.` }],
        isError: true,
      };
    }

    let query = supabase
      .from("character_inventory")
      .select(
        "id, equipped_slot, current_durability, applied_gems, crafted_level, items(name, rarity, slot, item_type, level, weapon_die, stats, description)",
      )
      .eq("character_id", character.id);
    if (equipped_only) query = query.not("equipped_slot", "is", null);

    const { data, error } = await query;
    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }

    const rows = data ?? [];
    if (rows.length === 0) {
      return { content: [{ type: "text", text: `${character.name} carries nothing.` }] };
    }
    const lines = rows.map((row: any) => {
      const item = row.items ?? {};
      const equipped = row.equipped_slot ? ` [equipped: ${row.equipped_slot}]` : "";
      return `${item.name ?? "Unknown item"} (${item.rarity ?? "?"}${item.slot ? `, ${item.slot}` : ""}) — durability ${row.current_durability}${equipped}`;
    });

    return {
      content: [{ type: "text", text: `${character.name}'s belongings:\n${lines.join("\n")}` }],
      structuredContent: { character: character.name, items: rows },
    };
  },
});
