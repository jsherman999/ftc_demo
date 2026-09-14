// BIOBUZZ (2026-2027 FIRST Tech Challenge) field geometry.
//
// Every number is in inches, in the official FTC Field Coordinate System
// (ftc-docs "Field Coordinate System Definition"):
//   * origin (0,0,0) at the centre of the field on the top surface of the tiles
//   * +Z up
//   * the red ALLIANCE AREA is on the LEFT as seen from the audience (same
//     "inverted" square layout as DECODE), so:
//       +Y runs from the red wall across the field toward the blue wall
//       +X runs toward the AUDIENCE (the front of the field)
//   * headings are measured counter-clockwise from +X, in degrees.
//
// Sources (Competition Manual V1, 12 Sep 2026, Section 9 "ARENA", pages 63+):
//   9.1  FIELD 144 in x 144 in nominal (+/- 1 in general tolerance), 36 tiles
//        of 24 in x 24 in x 0.59 in.
//   9.3  ALLIANCE AREA 97 in x 54 in outside the wall. LOADING ZONE 23 x 11 in.
//   9.4  GARDEN: 2 in tape strip, 23 in long, in the corner near the alliance.
//   9.5  FLOWER: perimeter mounted, 4 in top opening 21.5 in above the tiles,
//        retrieval opening at the bottom; four on the field.
//   9.6  HIVE: two bi-stable HIVEs on one frame at field centre, pivots 43.95 in
//        above the tiles, 25.5 in centre-to-centre; each CELL 20 in wide,
//        14 in tall, tilted 30 deg; up-CELL lip 53.5 in, top 65.6 in.
//   9.9  AprilTags: 3.25 in, family 36h11, 4-tag cluster on the bottom face of
//        every CELL; IDs 30-45.
// Where a value was measured from a manual figure rather than printed, the
// comment says so.

export const FIELD = Object.freeze({
  size: 144,          // inside wall to inside wall (nominal)
  half: 72,
  tile: 24,
  tileThickness: 0.59,
  wallHeight: 11.5,   // top of perimeter above the tile surface (12.125 - 0.59)
  wallThickness: 1.0,
  tilesPerSide: 6,
});

// Field frame helpers ---------------------------------------------------------

/** Tile seams (inner ones) along either axis. */
export const TILE_SEAMS = Object.freeze([-48, -24, 0, 24, 48]);

// Scoring elements ------------------------------------------------------------
export const POLLEN = Object.freeze({
  name: 'POLLEN', diameter: 2.80, radius: 1.40, massKg: 0.02495, color: 'yellow',
  count: 40,
});
export const NECTAR = Object.freeze({
  name: 'NECTAR', diameter: 3.62, radius: 1.81, massKg: 0.04128, // per alliance colour
  countPerAlliance: 8,
});
/** Mass of one NECTAR expressed in POLLEN units (used for HIVE tipping). */
export const NECTAR_POLLEN_EQUIV = NECTAR.massKg / POLLEN.massKg; // ~1.65

// HIVE structure --------------------------------------------------------------
// The pivot axis of both HIVEs is parallel to Y at X = 0 (a line running from
// the red wall to the blue wall), 43.95 in above the tiles. The red HIVE is on
// the red half (negative Y), the blue HIVE on the blue half.
export const HIVE = Object.freeze({
  pivotZ: 43.95,
  tiltDeg: 30,
  centerY: Object.freeze({ red: -12.75, blue: 12.75 }),
  // At the start of a match the red HIVE's upward CELL faces the audience (+X)
  // and the blue HIVE's upward CELL faces away from the audience (-X)
  // (Figure 10-2 staging; NECTAR is staged in the upward CELLs).
  startUpSide: Object.freeze({ red: +1, blue: -1 }),
  cell: Object.freeze({
    // Distances along the tilted arm from the pivot: the CELL occupies
    // a in [aIn, aOut]; its open mouth is at aOut.
    aIn: 9.42,
    aOut: 21.46,
    depth: 12.04,
    width: 20,        // across the CELL (along Y)
    height: 14,       // pentagon height
    shoulder: 7.61,   // height of the vertical sides before the roof
    b0: -1.3625,      // base of the pentagon below the arm line (derived so the lip is at 53.5 in)
    lipZ: 53.5,       // published: bottom edge of the upward CELL mouth
    topZ: 65.6,       // published: top of the upward CELL mouth
  }),
  // Frame footprint (base of the A-frame legs and foot bars): 49.46 in along Y
  // by 38.95 in along X, centred on the field (Event Field Setup Guide top view).
  frame: Object.freeze({
    lengthY: 49.46,
    depthX: 38.95,
    footBarWidth: 1.46,
    footBarY: 24.0,           // both foot bars run parallel to X at Y = +/-24
    footBarHalfLength: 19.475,
    legBase: Object.freeze([  // [X, Y] of the four leg bases (measured from Fig 9-10)
      [-18.95, -23.9], [18.95, -23.9], [-18.95, 23.9], [18.95, 23.9],
    ]),
    legTop: Object.freeze([   // [X, Y] where the leg centre-lines meet, z ~42.45
      [0, -12.4], [0, -12.4], [0, 12.4], [0, 12.4],
    ]),
    legTopZ: 42.45,
    legRadius: 0.6,
    lowestCellZ: 30.65,        // lowest point of a downward CELL (robots may pass under)
  }),
  // AprilTag clusters (Section 9.9, Figures 9-15..9-17). Four 3.25 in 36h11
  // tags on the bottom face of every CELL, IDs ascending left to right.
  tagSize: 3.25,
  tagFamily: '36h11',
  tagSlotOffsets: Object.freeze([-6.5, -2.75, 2.75, 6.5]),
  clusters: Object.freeze([
    { alliance: 'red', side: -1, label: 'RED SCORING', ids: [30, 31, 32, 33] },
    { alliance: 'red', side: +1, label: 'RED AUDIENCE', ids: [34, 35, 36, 37] },
    { alliance: 'blue', side: +1, label: 'BLUE AUDIENCE', ids: [38, 39, 40, 41] },
    { alliance: 'blue', side: -1, label: 'BLUE SCORING', ids: [42, 43, 44, 45] },
  ]),
});

const SIN30 = 0.5;
const COS30 = Math.sqrt(3) / 2;

/**
 * Convert a field point to HIVE body coordinates for the HIVE whose centre is
 * at Y = centerY and whose upward CELL sits on side `upSide` (+1 = audience).
 *   w: across the CELL (Y - centerY)
 *   a: along the tilted arm toward the upward CELL (positive = up CELL)
 *   b: perpendicular to the arm ("up" in the body frame)
 */
export function fieldToHiveBody(x, y, z, centerY, upSide) {
  const w = y - centerY;
  const u = upSide * x;                // horizontal distance toward the up side
  const dz = z - HIVE.pivotZ;
  const a = u * COS30 + dz * SIN30;
  const b = -u * SIN30 + dz * COS30;
  return { w, a, b };
}

/** Inverse of fieldToHiveBody. */
export function hiveBodyToField(w, a, b, centerY, upSide) {
  const u = a * COS30 - b * SIN30;
  const z = HIVE.pivotZ + a * SIN30 + b * COS30;
  return { x: upSide * u, y: centerY + w, z };
}

/** Pentagon cross-section of a CELL in (w, b) body coordinates. */
export function cellPentagon() {
  const c = HIVE.cell;
  const hw = c.width / 2;
  return [
    [-hw, c.b0], [hw, c.b0], [hw, c.b0 + c.shoulder], [0, c.b0 + c.height], [-hw, c.b0 + c.shoulder],
  ];
}

/** Point-in-polygon (even-odd). */
export function pointInPolygon(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersect = ((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Centre of the upward CELL mouth (the aiming point) in field coordinates. */
export function upCellMouthCenter(alliance, upSide) {
  const c = HIVE.cell;
  // centroid of the pentagon in b (relative to b0): 5.56 in (from the shot-sim
  // cross-check of the manual figure)
  return hiveBodyToField(0, c.aOut, c.b0 + 5.56, HIVE.centerY[alliance], upSide);
}

/** Field pose of an AprilTag cluster origin (centre of the CELL opening's bottom face). */
export function cellTagClusterPose(alliance, side, upSide) {
  const c = HIVE.cell;
  const centerY = HIVE.centerY[alliance];
  const isUp = side === upSide;
  // On the up CELL the bottom face is the pentagon base (b = b0); the down CELL
  // is the mirror image on the other side of the pivot (a negative).
  const a = isUp ? (c.aIn + c.aOut) / 2 : -(c.aIn + c.aOut) / 2;
  const b = isUp ? c.b0 : -c.b0;
  const p = hiveBodyToField(0, a, b, centerY, upSide);
  return { ...p, faceDown: !isUp ? true : false, isUpCell: isUp };
}

// FLOWERs ---------------------------------------------------------------------
// One FLOWER on each wall, centred on a tile seam 24 in from the corner, with
// the pipe axis about 2.3 in inside the wall face.
const FLOWER_INSET = 2.3;
export const FLOWER = Object.freeze({
  openingDiameter: 4.0,
  openingZ: 21.5,
  footprintAlongWall: 5.9,
  footprintDepth: 4.8,
  scoringHeight: 17.0,     // stack height of the scoring volume (top ring to middle ring)
  startPollen: 4,
  list: Object.freeze([
    // wall = outward normal direction of the wall the FLOWER is mounted on
    { id: 0, name: 'FLOWER (rear wall, red side)',  x: -(72 - FLOWER_INSET), y: -24, wall: [-1, 0] },
    { id: 1, name: 'FLOWER (blue wall, rear side)', x: -24, y: 72 - FLOWER_INSET, wall: [0, 1] },
    { id: 2, name: 'FLOWER (audience wall, blue side)', x: 72 - FLOWER_INSET, y: 24, wall: [1, 0] },
    { id: 3, name: 'FLOWER (red wall, audience side)', x: 24, y: -(72 - FLOWER_INSET), wall: [0, -1] },
  ]),
});

// Taped zones -----------------------------------------------------------------
export const LOADING_ZONE = Object.freeze({
  // 23 in along the alliance wall, 11 in deep, on the rear (away from the audience) half.
  red: Object.freeze({ x0: -48, x1: -24, y0: -72, y1: -61 }),
  blue: Object.freeze({ x0: 24, x1: 48, y0: 61, y1: 72 }),
});

export const GARDEN = Object.freeze({
  // 2 in tape, 23 in long, along the audience wall in the corner nearest the alliance.
  red: Object.freeze({ x0: 68, x1: 70, y0: -72, y1: -48 }),
  blue: Object.freeze({ x0: -70, x1: -68, y0: 48, y1: 72 }),
  startPollen: 4,
});

export const ALLIANCE_AREA = Object.freeze({
  // Outside the field: 97 in wide (along X) by 54 in deep (along Y).
  red: Object.freeze({ x0: -48.5, x1: 48.5, y0: -126, y1: -72 }),
  blue: Object.freeze({ x0: -48.5, x1: 48.5, y0: 72, y1: 126 }),
});

/** Robot starting poses (touching the alliance wall, outside the LOADING ZONE and FLOWERs). */
export const START_POSES = Object.freeze({
  red: Object.freeze([
    { name: 'Red, audience side', x: 48, y: -63, headingDeg: 90 },
    { name: 'Red, rear side', x: -12, y: -63, headingDeg: 90 },
  ]),
  blue: Object.freeze([
    { name: 'Blue, audience side', x: 48, y: 63, headingDeg: -90 },
    { name: 'Blue, rear side', x: -12, y: 63, headingDeg: -90 },
  ]),
});

export function rectContains(r, x, y, margin = 0) {
  return x >= r.x0 - margin && x <= r.x1 + margin && y >= r.y0 - margin && y <= r.y1 + margin;
}

/** Rectangle overlap test between an axis-aligned rect and a robot's OBB corners. */
export function polygonOverlapsRect(corners, r) {
  // separating axis on the rect's axes is enough for a quick "is any part inside"
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  for (const [x, y] of corners) {
    if (x < minx) minx = x; if (x > maxx) maxx = x;
    if (y < miny) miny = y; if (y > maxy) maxy = y;
  }
  if (maxx < r.x0 || minx > r.x1 || maxy < r.y0 || miny > r.y1) return false;
  // check the rect corners against the OBB and the OBB corners against the rect
  for (const [x, y] of corners) if (rectContains(r, x, y)) return true;
  const rc = [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]];
  for (const [x, y] of rc) if (pointInPolygon(x, y, corners)) return true;
  // edge crossing (thin rects like the GARDEN tape)
  for (let i = 0; i < 4; i++) {
    const a = corners[i], b = corners[(i + 1) % 4];
    for (let j = 0; j < 4; j++) {
      if (segmentsIntersect(a, b, rc[j], rc[(j + 1) % 4])) return true;
    }
  }
  return false;
}

export function segmentsIntersect(p1, p2, p3, p4) {
  const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
  if (Math.abs(d) < 1e-12) return false;
  const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
  const u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/**
 * Static obstacles a robot can collide with, as convex polygons in the X/Y plane
 * (everything below `robotHeight` inches). The HIVE legs lean inward, so their
 * footprint at robot height is a thin quadrilateral from the base to the point
 * at that height.
 */
export function robotObstacles(robotHeight = 18) {
  const obs = [];
  const f = HIVE.frame;
  // foot bars
  for (const sy of [-1, 1]) {
    const y = sy * f.footBarY;
    const hw = f.footBarWidth / 2;
    obs.push({ name: 'HIVE foot bar', poly: [
      [-f.footBarHalfLength, y - hw], [f.footBarHalfLength, y - hw],
      [f.footBarHalfLength, y + hw], [-f.footBarHalfLength, y + hw]] });
  }
  // legs (projected from the floor up to robotHeight)
  const t = Math.min(1, robotHeight / f.legTopZ);
  for (let i = 0; i < 4; i++) {
    const [bx, by] = f.legBase[i];
    const [tx, ty] = f.legTop[i];
    const ex = bx + (tx - bx) * t, ey = by + (ty - by) * t;
    const dx = ex - bx, dy = ey - by;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len * f.legRadius, ny = dx / len * f.legRadius;
    obs.push({ name: 'HIVE leg', poly: [[bx + nx, by + ny], [ex + nx, ey + ny], [ex - nx, ey - ny], [bx - nx, by - ny]] });
  }
  // FLOWERs (small boxes against the wall)
  for (const fl of FLOWER.list) {
    const [wx, wy] = fl.wall;
    const along = FLOWER.footprintAlongWall / 2, deep = FLOWER.footprintDepth / 2;
    const ax = wy !== 0 ? along : deep;  // half-extent along X
    const ay = wx !== 0 ? along : deep;  // half-extent along Y
    // the box sits flush against the inside face of the wall
    const cx = wx !== 0 ? wx * (FIELD.half - deep) : fl.x;
    const cy = wy !== 0 ? wy * (FIELD.half - deep) : fl.y;
    obs.push({ name: fl.name, poly: [[cx - ax, cy - ay], [cx + ax, cy - ay], [cx + ax, cy + ay], [cx - ax, cy + ay]] });
  }
  return obs;
}

/** The four perimeter walls as thick rectangles just outside the playing surface. */
export function wallPolygons() {
  const h = FIELD.half, t = FIELD.wallThickness;
  return [
    { name: 'wall +X (audience)', poly: [[h, -h - t], [h + t, -h - t], [h + t, h + t], [h, h + t]] },
    { name: 'wall -X (rear)', poly: [[-h - t, -h - t], [-h, -h - t], [-h, h + t], [-h - t, h + t]] },
    { name: 'wall +Y (blue)', poly: [[-h - t, h], [h + t, h], [h + t, h + t], [-h - t, h + t]] },
    { name: 'wall -Y (red)', poly: [[-h - t, -h - t], [h + t, -h - t], [h + t, -h], [-h - t, -h]] },
  ];
}
