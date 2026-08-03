import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_characters",
  title: "List characters",
  description:
    "List the signed-in player's characters in Wayfarers of Varneth with class, race, level, gold and vital resources.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("characters")
      .select(
        "id, name, family_name, race, class, level, gold, hp, max_hp, cp, max_cp, mp, max_mp, ac, renown, last_online",
      )
      .order("name", { ascending: true });

    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    const characters = data ?? [];
    if (characters.length === 0) {
      return { content: [{ type: "text", text: "No characters yet — create one in the app first." }] };
    }
    const lines = characters.map(
      (c: any) =>
        `${c.name}${c.family_name ? ` ${c.family_name}` : ""} — level ${c.level} ${c.race} ${c.class} · HP ${c.hp}/${c.max_hp} · CP ${c.cp}/${c.max_cp} · MP ${c.mp}/${c.max_mp} · AC ${c.ac} · ${c.gold} gold`,
    );
    return {
      content: [{ type: "text", text: lines.join("\n") }],
      structuredContent: { characters },
    };
  },
});
