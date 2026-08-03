import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "get_character",
  title: "Get character sheet",
  description:
    "Read the full sheet for one of the signed-in player's characters by name: attributes, resources, renown, progress and current location.",
  inputSchema: {
    name: z.string().trim().min(1).describe("Character's first name, e.g. 'Calikon'."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ name }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data: character, error } = await supabase
      .from("characters")
      .select("*")
      .ilike("name", name)
      .maybeSingle();

    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    if (!character) {
      return {
        content: [{ type: "text", text: `No character named "${name}" on this account.` }],
        isError: true,
      };
    }

    let location: { name: string; description: string } | null = null;
    if (character.current_node_id) {
      const { data: node } = await supabase
        .from("nodes")
        .select("name, description")
        .eq("id", character.current_node_id)
        .maybeSingle();
      location = node ?? null;
    }

    const summary = [
      `${character.name}${character.family_name ? ` ${character.family_name}` : ""} — level ${character.level} ${character.race} ${character.class}`,
      `HP ${character.hp}/${character.max_hp} · CP ${character.cp}/${character.max_cp} · MP ${character.mp}/${character.max_mp} · AC ${character.ac}`,
      `STR ${character.str} · DEX ${character.dex} · CON ${character.con} · INT ${character.int} · WIS ${character.wis} · CHA ${character.cha}`,
      `XP ${character.xp} · Renown ${character.renown ?? 0} · Boss Hunter Points ${character.bhp} · ${character.gold} gold`,
      location ? `Location: ${location.name}` : "Location: unknown",
    ].join("\n");

    return {
      content: [{ type: "text", text: summary }],
      structuredContent: { character, location },
    };
  },
});
