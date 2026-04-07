/**
 * Union-of-circles outline computation.
 * Shared between admin world map and player graph view.
 */

export interface Circle { cx: number; cy: number; r: number; }

interface ExposedArc {
  circleIdx: number;
  startAngle: number;
  endAngle: number;
  startPt: { x: number; y: number };
  endPt: { x: number; y: number };
}

function normalizeAngle(a: number): number {
  a = a % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a;
}

function ptOnCircle(c: Circle, angle: number): { x: number; y: number } {
  return { x: c.cx + c.r * Math.cos(angle), y: c.cy + c.r * Math.sin(angle) };
}

function ptDist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

export type OutlineBBox = { minX: number; minY: number; maxX: number; maxY: number; cx: number; cy: number; w: number; h: number };

export function computeRegionOutline(circles: Circle[]): { paths: string[]; bbox: OutlineBBox } {
  const emptyBBox: OutlineBBox = { minX: 0, minY: 0, maxX: 0, maxY: 0, cx: 0, cy: 0, w: 0, h: 0 };
  if (circles.length === 0) return { paths: [], bbox: emptyBBox };

  let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
  for (const c of circles) {
    bMinX = Math.min(bMinX, c.cx - c.r);
    bMinY = Math.min(bMinY, c.cy - c.r);
    bMaxX = Math.max(bMaxX, c.cx + c.r);
    bMaxY = Math.max(bMaxY, c.cy + c.r);
  }
  const bbox: OutlineBBox = { minX: bMinX, minY: bMinY, maxX: bMaxX, maxY: bMaxY, cx: (bMinX + bMaxX) / 2, cy: (bMinY + bMaxY) / 2, w: bMaxX - bMinX, h: bMaxY - bMinY };

  if (circles.length === 1) {
    const c = circles[0];
    return { paths: [`M ${c.cx + c.r},${c.cy} A ${c.r},${c.r} 0 1,1 ${c.cx - c.r},${c.cy} A ${c.r},${c.r} 0 1,1 ${c.cx + c.r},${c.cy} Z`], bbox };
  }

  const arcs: ExposedArc[] = [];

  for (let i = 0; i < circles.length; i++) {
    const ci = circles[i];
    let skip = false;
    for (let j = 0; j < circles.length; j++) {
      if (i === j) continue;
      const d = ptDist({ x: ci.cx, y: ci.cy }, { x: circles[j].cx, y: circles[j].cy });
      if (d + ci.r <= circles[j].r + 1e-6) { skip = true; break; }
    }
    if (skip) continue;

    const angles: number[] = [];
    for (let j = 0; j < circles.length; j++) {
      if (i === j) continue;
      const cj = circles[j];
      const dx = cj.cx - ci.cx;
      const dy = cj.cy - ci.cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d >= ci.r + cj.r - 1e-9) continue;
      if (d + cj.r <= ci.r + 1e-9) continue;
      const a = Math.atan2(dy, dx);
      const cosH = (d * d + ci.r * ci.r - cj.r * cj.r) / (2 * d * ci.r);
      const h = Math.acos(Math.max(-1, Math.min(1, cosH)));
      angles.push(normalizeAngle(a - h));
      angles.push(normalizeAngle(a + h));
    }

    if (angles.length === 0) {
      arcs.push({ circleIdx: i, startAngle: 0, endAngle: 2 * Math.PI, startPt: ptOnCircle(ci, 0), endPt: ptOnCircle(ci, 0) });
      continue;
    }

    angles.sort((a, b) => a - b);
    const uniqueAngles: number[] = [angles[0]];
    for (let k = 1; k < angles.length; k++) {
      if (angles[k] - uniqueAngles[uniqueAngles.length - 1] > 1e-9) uniqueAngles.push(angles[k]);
    }

    for (let k = 0; k < uniqueAngles.length; k++) {
      const start = uniqueAngles[k];
      const end = uniqueAngles[(k + 1) % uniqueAngles.length];
      const span = k + 1 < uniqueAngles.length ? end - start : (end + 2 * Math.PI - start);
      if (span < 1e-9) continue;
      const mid = start + span / 2;
      const mx = ci.cx + ci.r * Math.cos(mid);
      const my = ci.cy + ci.r * Math.sin(mid);

      let inside = false;
      for (let j = 0; j < circles.length; j++) {
        if (i === j) continue;
        const dd = (mx - circles[j].cx) ** 2 + (my - circles[j].cy) ** 2;
        if (dd < circles[j].r * circles[j].r - 1e-6) { inside = true; break; }
      }

      if (!inside) {
        arcs.push({
          circleIdx: i, startAngle: start, endAngle: end,
          startPt: ptOnCircle(ci, start), endPt: ptOnCircle(ci, end),
        });
      }
    }
  }

  if (arcs.length === 0) return { paths: [], bbox };

  const used = new Array(arcs.length).fill(false);
  const paths: string[] = [];

  for (let startIdx = 0; startIdx < arcs.length; startIdx++) {
    if (used[startIdx]) continue;
    const firstArc = arcs[startIdx];

    if (Math.abs(firstArc.endAngle - firstArc.startAngle - 2 * Math.PI) < 1e-6 ||
        (firstArc.startAngle === 0 && Math.abs(firstArc.endAngle - 2 * Math.PI) < 1e-6)) {
      used[startIdx] = true;
      const c = circles[firstArc.circleIdx];
      paths.push(`M ${c.cx + c.r},${c.cy} A ${c.r},${c.r} 0 1,1 ${c.cx - c.r},${c.cy} A ${c.r},${c.r} 0 1,1 ${c.cx + c.r},${c.cy} Z`);
      continue;
    }

    used[startIdx] = true;
    const chain: ExposedArc[] = [firstArc];
    let current = firstArc;

    for (let iter = 0; iter < arcs.length; iter++) {
      let bestIdx = -1;
      let bestDist = Infinity;
      for (let j = 0; j < arcs.length; j++) {
        if (used[j]) continue;
        const d = ptDist(current.endPt, arcs[j].startPt);
        if (d < bestDist) { bestDist = d; bestIdx = j; }
      }
      if (bestIdx === -1 || bestDist > 3) break;
      used[bestIdx] = true;
      chain.push(arcs[bestIdx]);
      current = arcs[bestIdx];
      if (ptDist(current.endPt, firstArc.startPt) < 3) break;
    }

    let d = `M ${chain[0].startPt.x.toFixed(2)},${chain[0].startPt.y.toFixed(2)}`;
    for (const arc of chain) {
      const ci = circles[arc.circleIdx];
      let span = arc.endAngle - arc.startAngle;
      if (span < 0) span += 2 * Math.PI;
      const largeArc = span > Math.PI ? 1 : 0;
      d += ` A ${ci.r.toFixed(2)},${ci.r.toFixed(2)} 0 ${largeArc},1 ${arc.endPt.x.toFixed(2)},${arc.endPt.y.toFixed(2)}`;
    }
    d += ' Z';
    paths.push(d);
  }

  return { paths, bbox };
}
