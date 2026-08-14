Deno.serve(() => new Response(JSON.stringify({
  keys: Object.keys(Deno.env.toObject()).sort(),
}), { headers: { 'Content-Type': 'application/json' } }));
