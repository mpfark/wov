
DO $$
DECLARE
  area_uuid uuid := '81147cae-e384-4a31-aec3-97f318e3469c';
  dir_offsets jsonb := '{"N":[0,-1],"S":[0,1],"E":[1,0],"W":[-1,0],"NE":[1,-1],"NW":[-1,-1],"SE":[1,1],"SW":[-1,1]}';
  changed boolean := true;
  iterations int := 0;
  r record;
  conn record;
  dir text;
  dx int;
  dy int;
  target_id uuid;
  target_x int;
  target_y int;
BEGIN
  -- Create temp table for computed positions
  CREATE TEMP TABLE node_coords (
    id uuid PRIMARY KEY,
    x int,
    y int,
    computed boolean DEFAULT false
  );

  -- Insert all pasture nodes (uncomputed)
  INSERT INTO node_coords (id, x, y, computed)
  SELECT id, 0, 0, false FROM nodes WHERE area_id = area_uuid;

  -- Seed: For each pasture node that connects to a non-pasture node with known coords,
  -- compute the pasture node's position
  FOR r IN 
    SELECT n.id, n.connections 
    FROM nodes n 
    WHERE n.area_id = area_uuid AND NOT EXISTS (SELECT 1 FROM node_coords nc WHERE nc.id = n.id AND nc.computed)
  LOOP
    FOR conn IN SELECT * FROM jsonb_array_elements(r.connections)
    LOOP
      target_id := (conn.value->>'node_id')::uuid;
      dir := conn.value->>'direction';
      
      -- Check if target is outside the area and has real coordinates
      IF NOT EXISTS (SELECT 1 FROM nodes WHERE id = target_id AND area_id = area_uuid) THEN
        SELECT n.x, n.y INTO target_x, target_y FROM nodes n WHERE n.id = target_id;
        IF FOUND AND dir_offsets ? dir THEN
          dx := (dir_offsets->dir->>0)::int;
          dy := (dir_offsets->dir->>1)::int;
          -- P connects to target via direction D, so target = P + offset(D), thus P = target - offset(D)
          UPDATE node_coords SET x = target_x - dx, y = target_y - dy, computed = true WHERE id = r.id AND NOT computed;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- BFS: iterate until no more changes
  WHILE changed AND iterations < 100 LOOP
    changed := false;
    iterations := iterations + 1;
    
    FOR r IN 
      SELECT nc.id, nc.x, nc.y, n.connections 
      FROM node_coords nc 
      JOIN nodes n ON n.id = nc.id 
      WHERE nc.computed = true
    LOOP
      FOR conn IN SELECT * FROM jsonb_array_elements(r.connections)
      LOOP
        target_id := (conn.value->>'node_id')::uuid;
        dir := conn.value->>'direction';
        
        -- Only process pasture nodes that aren't computed yet
        IF EXISTS (SELECT 1 FROM node_coords WHERE id = target_id AND NOT computed) AND dir_offsets ? dir THEN
          dx := (dir_offsets->dir->>0)::int;
          dy := (dir_offsets->dir->>1)::int;
          UPDATE node_coords SET x = r.x + dx, y = r.y + dy, computed = true WHERE id = target_id AND NOT computed;
          IF FOUND THEN changed := true; END IF;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  -- Apply computed positions back to nodes table
  UPDATE nodes SET x = nc.x, y = nc.y
  FROM node_coords nc
  WHERE nodes.id = nc.id AND nc.computed = true;

  -- Log how many were updated
  RAISE NOTICE 'Updated % nodes in % iterations', (SELECT count(*) FROM node_coords WHERE computed), iterations;

  DROP TABLE node_coords;
END;
$$;
