import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-drain-secret",
};

const HARD_CAP = 10;

const STYLE_SUFFIX =
  "Dark fantasy painterly scene illustration, dramatic chiaroscuro lighting, atmospheric, parchment-aged color palette, no text, no watermark, no border, no characters, environmental hero shot, square 1:1 composition.";

type TargetKind = "area" | "node";
interface Target {
  kind: TargetKind;
  id: string;
  name: string;
  description: string;
  area_id?: string | null;
  region_id?: string | null;
}

function buildAreaPrompt(area: any, region: any): string {
  const parts: string[] = [];
  parts.push(`A scene illustration of "${area?.name || "an unnamed area"}".`);
  if (area?.description) parts.push(`Area: ${area.description}`);
  if (area?.flavor_text) parts.push(area.flavor_text);
  if (area?.creature_types) parts.push(`Known inhabitants: ${area.creature_types}.`);
  if (region) {
    const r: string[] = [];
    if (region.name) r.push(`within the region "${region.name}"`);
    if (region.description) r.push(region.description);
    if (r.length) parts.push(`Region mood: ${r.join(". ")}.`);
  }
  parts.push(`Style: ${STYLE_SUFFIX}`);
  return parts.join(" ");
}

function buildNodePrompt(node: any, area: any, region: any): string {
  const parts: string[] = [];
  const nodeName = (node?.name || "an unnamed place").toString().trim();
  const nodeDesc = (node?.description || "").toString().trim();
  parts.push(`A scene illustration of "${nodeName}".`);
  if (nodeDesc) parts.push(`Location: ${nodeDesc}`);
  if (area) {
    const a: string[] = [];
    if (area.name) a.push(`part of the area "${area.name}"`);
    if (area.description) a.push(area.description);
    if (area.flavor_text) a.push(area.flavor_text);
    if (area.creature_types) a.push(`Known inhabitants: ${area.creature_types}.`);
    if (a.length) parts.push(`Area context: ${a.join(". ")}.`);
  }
  if (region) {
    const r: string[] = [];
    if (region.name) r.push(`within the region "${region.name}"`);
    if (region.description) r.push(region.description);
    if (r.length) parts.push(`Region mood: ${r.join(". ")}.`);
  }
  parts.push(`Style: ${STYLE_SUFFIX}`);
  return parts.join(" ");
}

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; contentType: string } {
  const m = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
  if (!m) throw new Error("Invalid data URL from AI gateway");
  const contentType = m[1] || "image/png";
  const b64 = m[2];
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, contentType };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supplied = req.headers.get("x-drain-secret");
  const expected = Deno.env.get("DRAIN_CRON_SECRET");
  if (!expected || !supplied || supplied !== expected) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: runRow, error: runErr } = await admin
    .from("ai_credit_drain_log")
    .insert({ cap: HARD_CAP, stop_reason: "in_progress" })
    .select("id")
    .single();
  if (runErr || !runRow) {
    console.error("Failed to open drain log", runErr);
    return new Response(JSON.stringify({ error: "Failed to open drain log" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const runId = runRow.id;

  let generated = 0;
  let stopReason: string = "cap_hit";
  let notes = "";

  try {
    // 1) Areas missing illustration (priority — whole-area look)
    const { data: areasMissing, error: aErr } = await admin
      .from("areas")
      .select("id, name, description, flavor_text, creature_types, region_id")
      .or("illustration_url.is.null,illustration_url.eq.")
      .limit(HARD_CAP);
    if (aErr) throw new Error(`Area query failed: ${aErr.message}`);

    // 2) Named nodes missing illustration (skip unnamed — area art covers them)
    const remaining = Math.max(0, HARD_CAP - (areasMissing?.length || 0));
    let namedNodes: any[] = [];
    if (remaining > 0) {
      const { data: nodesMissing, error: nErr } = await admin
        .from("nodes")
        .select("id, name, description, area_id, region_id")
        .or("illustration_url.is.null,illustration_url.eq.")
        .not("name", "is", null)
        .neq("name", "")
        .limit(remaining);
      if (nErr) throw new Error(`Node query failed: ${nErr.message}`);
      namedNodes = nodesMissing || [];
    }

    const targets: Target[] = [
      ...(areasMissing || []).map((a: any) => ({
        kind: "area" as const,
        id: a.id,
        name: a.name,
        description: a.description,
        region_id: a.region_id,
      })),
      ...namedNodes.map((n: any) => ({
        kind: "node" as const,
        id: n.id,
        name: n.name,
        description: n.description,
        area_id: n.area_id,
        region_id: n.region_id,
      })),
    ];

    if (targets.length === 0) {
      stopReason = "no_targets";
    } else {
      // Pre-fetch parent areas (for node prompts) and regions
      const areaIds = Array.from(new Set(targets.map((t) => t.area_id).filter(Boolean))) as string[];
      const regionIds = Array.from(new Set(targets.map((t) => t.region_id).filter(Boolean))) as string[];
      const [{ data: areas }, { data: regions }] = await Promise.all([
        areaIds.length
          ? admin.from("areas").select("id, name, description, flavor_text, creature_types").in("id", areaIds)
          : Promise.resolve({ data: [] as any[] }),
        regionIds.length
          ? admin.from("regions").select("id, name, description").in("id", regionIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);
      const areaMap = new Map((areas || []).map((a: any) => [a.id, a]));
      const regionMap = new Map((regions || []).map((r: any) => [r.id, r]));

      for (const t of targets) {
        if (generated >= HARD_CAP) {
          stopReason = "cap_hit";
          break;
        }

        const region = t.region_id ? regionMap.get(t.region_id) : null;
        let prompt: string;
        if (t.kind === "area") {
          prompt = buildAreaPrompt(
            { name: t.name, description: t.description, flavor_text: (areasMissing || []).find((x: any) => x.id === t.id)?.flavor_text, creature_types: (areasMissing || []).find((x: any) => x.id === t.id)?.creature_types },
            region,
          );
        } else {
          const area = t.area_id ? areaMap.get(t.area_id) : null;
          prompt = buildNodePrompt({ name: t.name, description: t.description }, area, region);
        }

        const logBase = {
          run_id: runId,
          target_type: t.kind,
          node_id: t.kind === "node" ? t.id : null,
          area_id: t.kind === "area" ? t.id : null,
        };

        try {
          const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${LOVABLE_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "google/gemini-3.1-flash-image-preview",
              messages: [{ role: "user", content: prompt }],
              modalities: ["image", "text"],
            }),
          });

          if (aiResp.status === 402) {
            await aiResp.text();
            stopReason = "credits_exhausted";
            await admin.from("ai_credit_drain_item_log").insert({
              ...logBase,
              status: "error",
              error: "Credits exhausted (402)",
            });
            break;
          }
          if (!aiResp.ok) {
            const txt = await aiResp.text();
            await admin.from("ai_credit_drain_item_log").insert({
              ...logBase,
              status: "error",
              error: `AI ${aiResp.status}: ${txt.slice(0, 300)}`,
            });
            continue;
          }

          const aiJson = await aiResp.json();
          const dataUrl: string | undefined = aiJson?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
          if (!dataUrl) throw new Error("AI returned no image");
          const { bytes, contentType } = dataUrlToBytes(dataUrl);
          const ext = contentType.includes("jpeg") ? "jpg" : "png";
          const bucket = t.kind === "area" ? "area-illustrations" : "node-illustrations";
          const path = `${t.id}-${Date.now()}.${ext}`;

          // Try preferred bucket, fall back to node-illustrations if the area bucket doesn't exist
          let useBucket = bucket;
          let upErr = (await admin.storage.from(useBucket).upload(path, bytes, { contentType, upsert: true })).error;
          if (upErr && t.kind === "area") {
            useBucket = "node-illustrations";
            upErr = (await admin.storage.from(useBucket).upload(path, bytes, { contentType, upsert: true })).error;
          }
          if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

          const { data: pub } = admin.storage.from(useBucket).getPublicUrl(path);
          const publicUrl = pub.publicUrl;

          const table = t.kind === "area" ? "areas" : "nodes";
          const { error: updErr } = await admin
            .from(table)
            .update({
              illustration_url: publicUrl,
              illustration_metadata: {
                model: "google/gemini-3.1-flash-image-preview",
                generated_at: new Date().toISOString(),
                source: "monthly-scene-drain",
                prompt,
              },
            })
            .eq("id", t.id);
          if (updErr) throw new Error(`${table} update failed: ${updErr.message}`);

          generated += 1;
          await admin.from("ai_credit_drain_item_log").insert({
            ...logBase,
            status: "success",
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`${t.kind} generation failed`, t.id, msg);
          await admin.from("ai_credit_drain_item_log").insert({
            ...logBase,
            status: "error",
            error: msg.slice(0, 500),
          });
        }
      }

      if (generated >= HARD_CAP) stopReason = "cap_hit";
      else if (stopReason !== "credits_exhausted") stopReason = generated > 0 ? "cap_hit" : "no_targets";
    }
  } catch (e) {
    stopReason = "error";
    notes = e instanceof Error ? e.message : String(e);
    console.error("Drain run failed", notes);
  }

  await admin
    .from("ai_credit_drain_log")
    .update({
      run_finished_at: new Date().toISOString(),
      generated_count: generated,
      stop_reason: stopReason,
      notes: notes || null,
    })
    .eq("id", runId);

  return new Response(
    JSON.stringify({ run_id: runId, generated, stop_reason: stopReason }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
