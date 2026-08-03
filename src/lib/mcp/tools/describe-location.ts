import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "describe_location",
  title: "Describe a world location",
  description:
    "Describe a location (node) in the world of Varneth: its description, region, area, services and exits. Omit the name to describe where a character currently stands.",
  inputSchema: {
    node_name: z.string().trim().min(1).optional().describe("Location name, e.g. 'Hearthvale Square'."),
    character_name: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Describe where this character of the signed-in player currently stands."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ node_name, character_name }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    if (!node_name && !character_name) {
      return {
        content: [{ type: "text", text: "Provide either node_name or character_name." }],
        isError: true,
      };
    }
    const supabase = supabaseForUser(ctx);

    let nodeId: string | null = null;
    if (!node_name && character_name) {
      const { data: character } = await supabase
        .from("characters")
        .select("current_node_id")
        .ilike("name", character_name)
        .maybeSingle();
      if (!character?.current_node_id) {
        return {
          content: [{ type: "text", text: `Could not locate a character named "${character_name}".` }],
          isError: true,
        };
      }
      nodeId = character.current_node_id;
    }

    const selection =
      "id, name, description, x, y, connections, is_inn, is_vendor, is_blacksmith, is_jewelcrafter, is_marketplace, is_trainer, is_teleport, is_soulforge, is_stonebinder, is_heraldry, class_hall, regions(name), areas(name, area_type)";
    const query = supabase.from("nodes").select(selection);
    const { data: node, error } = nodeId
      ? await query.eq("id", nodeId).maybeSingle()
      : await query.ilike("name", node_name!).maybeSingle();

    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    if (!node) {
      return {
        content: [{ type: "text", text: `No known location matching "${node_name}".` }],
        isError: true,
      };
    }

    const services = Object.entries(node)
      .filter(([key, value]) => key.startsWith("is_") && value === true)
      .map(([key]) => key.replace("is_", "").replace(/_/g, " "));
    const exits = Array.isArray(node.connections)
      ? node.connections.map((c: any) => c?.direction ?? c).filter(Boolean)
      : [];

    const text = [
      `${node.name} (${(node as any).regions?.name ?? "unknown region"}${(node as any).areas?.name ? ` · ${(node as any).areas.name}` : ""}) at grid ${node.x},${node.y}`,
      node.description,
      services.length ? `Services: ${services.join(", ")}` : "Services: none",
      exits.length ? `Exits: ${exits.join(", ")}` : "Exits: none recorded",
    ].join("\n\n");

    return { content: [{ type: "text", text }], structuredContent: { node } };
  },
});
