import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listCharactersTool from "./tools/list-characters";
import getCharacterTool from "./tools/get-character";
import listInventoryTool from "./tools/list-inventory";
import describeLocationTool from "./tools/describe-location";

// Issuer must be the direct Supabase host, built from the inlined project ref.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "wovarneth",
  title: "WoVarneth",
  version: "0.1.0",
  instructions:
    "Tools for Wayfarers of Varneth, a fantasy MUD. Use `list_characters` to see the signed-in player's characters, `get_character` for a full character sheet, `list_inventory` for their gear, and `describe_location` for world locations. All tools act as the signed-in player and only expose their own characters.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listCharactersTool, getCharacterTool, listInventoryTool, describeLocationTool],
});
