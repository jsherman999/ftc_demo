// Small 2-D geometry toolkit: convex polygon overlap (separating axis theorem)
// with minimum translation vector, ray casting, circle helpers.

export function robotCorners(x, y, headingRad, length, width) {
  const c = Math.cos(headingRad), s = Math.sin(headingRad);
  const hl = length / 2, hw = width / 2;
  const local = [[hl, hw], [hl, -hw], [-hl, -hw], [-hl, hw]];
  return local.map(([lx, ly]) => [x + lx * c - ly * s, y + lx * s + ly * c]);
}

function axesOf(poly) {
  const axes = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const len = Math.hypot(ex, ey) || 1;
    axes.push([-ey / len, ex / len]);
  }
  return axes;
}

function project(poly, ax) {
  let min = Infinity, max = -Infinity;
  for (const [x, y] of poly) {
    const p = x * ax[0] + y * ax[1];
    if (p < min) min = p;
    if (p > max) max = p;
  }
  return [min, max];
}

/**
 * SAT overlap between two convex polygons. Returns null if separated, otherwise
 * {nx, ny, depth}: the minimum translation (push `a` by depth along (nx,ny)).
 */
export function polygonMTV(a, b) {
  let best = null;
  for (const ax of [...axesOf(a), ...axesOf(b)]) {
    const [amin, amax] = project(a, ax);
    const [bmin, bmax] = project(b, ax);
    const overlap = Math.min(amax - bmin, bmax - amin);
    if (overlap <= 0) return null;
    if (!best || overlap < best.depth) {
      // orient the axis so it pushes a away from b
      const ca = centroid(a), cb = centroid(b);
      const d = (ca[0] - cb[0]) * ax[0] + (ca[1] - cb[1]) * ax[1];
      best = { nx: d < 0 ? -ax[0] : ax[0], ny: d < 0 ? -ax[1] : ax[1], depth: overlap };
    }
  }
  return best;
}

export function centroid(poly) {
  let x = 0, y = 0;
  for (const p of poly) { x += p[0]; y += p[1]; }
  return [x / poly.length, y / poly.length];
}

/** Closest distance from a point to a convex polygon's boundary (0 if inside). */
export function pointPolygonDistance(px, py, poly) {
  let inside = true;
  let minD = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const d = pointSegmentDistance(px, py, a, b);
    if (d.dist < minD) minD = d.dist;
    const cross = (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]);
    if (cross < 0) inside = false; // assumes CCW polygons; we only need "outside" detection
  }
  return { dist: inside ? 0 : minD };
}

export function pointSegmentDistance(px, py, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 === 0 ? 0 : ((px - a[0]) * dx + (py - a[1]) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  const cx = a[0] + t * dx, cy = a[1] + t * dy;
  return { dist: Math.hypot(px - cx, py - cy), cx, cy };
}

/**
 * Circle vs convex polygon: returns {nx, ny, depth} to push the circle out,
 * or null if not touching.
 */
export function circlePolygonMTV(cx, cy, r, poly) {
  // treat the circle as a polygon-ish by SAT on polygon axes + axis to closest vertex
  const axes = axesOf(poly);
  let closest = null;
  for (const [x, y] of poly) {
    const d = Math.hypot(x - cx, y - cy);
    if (!closest || d < closest.d) closest = { d, x, y };
  }
  if (closest && closest.d > 0) axes.push([(closest.x - cx) / closest.d, (closest.y - cy) / closest.d]);
  let best = null;
  for (const ax of axes) {
    const [pmin, pmax] = project(poly, ax);
    const c = cx * ax[0] + cy * ax[1];
    const overlap = Math.min(c + r - pmin, pmax - (c - r));
    if (overlap <= 0) return null;
    if (!best || overlap < best.depth) {
      const cen = centroid(poly);
      const d = (cx - cen[0]) * ax[0] + (cy - cen[1]) * ax[1];
      best = { nx: d < 0 ? -ax[0] : ax[0], ny: d < 0 ? -ax[1] : ax[1], depth: overlap };
    }
  }
  return best;
}

/** Ray vs segment: returns distance along the ray or Infinity. */
export function raySegment(ox, oy, dx, dy, a, b) {
  const ex = b[0] - a[0], ey = b[1] - a[1];
  const den = dx * ey - dy * ex;
  if (Math.abs(den) < 1e-12) return Infinity;
  const t = ((a[0] - ox) * ey - (a[1] - oy) * ex) / den;
  const u = ((a[0] - ox) * dy - (a[1] - oy) * dx) / den;
  if (t >= 0 && u >= 0 && u <= 1) return t;
  return Infinity;
}

export function rayPolygon(ox, oy, dx, dy, poly) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const t = raySegment(ox, oy, dx, dy, poly[i], poly[(i + 1) % poly.length]);
    if (t < best) best = t;
  }
  return best;
}

export function rayCircle(ox, oy, dx, dy, cx, cy, r) {
  const fx = ox - cx, fy = oy - cy;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - r * r;
  const disc = b * b - 4 * c;
  if (disc < 0) return Infinity;
  const t = (-b - Math.sqrt(disc)) / 2;
  return t >= 0 ? t : Infinity;
}

export function normalizeAngle(rad) {
  while (rad > Math.PI) rad -= 2 * Math.PI;
  while (rad < -Math.PI) rad += 2 * Math.PI;
  return rad;
}
