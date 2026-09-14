// Canvas rendering of the BIOBUZZ field (top-down) and a HIVE side view.
//
// Screen mapping: the audience is at the bottom of the canvas (+X down the
// screen), the red wall on the left (-Y) and the blue wall on the right (+Y).
import { FIELD, HIVE, FLOWER, LOADING_ZONE, GARDEN, ALLIANCE_AREA, TILE_SEAMS, hiveBodyToField, cellPentagon } from '../field/geometry.js';
import { ROBOT_BODY, findSensor } from '../sim/robot-config.js';
import { robotCorners } from '../sim/collision.js';
import { clusterPoses } from '../sim/vision.js';

const COLORS = {
  tile: '#7b7f86', tileAlt: '#82868d', seam: '#5f636a', wall: '#2a2d33', wallTop: '#3d4148',
  red: '#d9342b', blue: '#2f6fd6', pollen: '#f2c230', pollenEdge: '#b98b0d',
  nectarRed: '#e04a3f', nectarBlue: '#4d88ff', tapeWhite: '#e8e8e8',
  robot: '#2c3e50', robotEdge: '#0f1a24', text: '#f5f5f5', hive: '#c9a227', hiveDark: '#8a6d12',
};

export class FieldRenderer {
  constructor(canvas, sideCanvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.sideCanvas = sideCanvas;
    this.sctx = sideCanvas ? sideCanvas.getContext('2d') : null;
    this.margin = 30; // inches of space drawn outside the field for the alliance areas
    this.showFov = true;
    this.showTrail = true;
    this.trail = [];
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const size = Math.max(200, Math.floor(rect.width));
    if (this.canvas.width !== Math.floor(size * dpr)) {
      this.canvas.width = Math.floor(size * dpr);
      this.canvas.height = Math.floor(size * dpr);
    }
    this.dpr = dpr;
    const total = FIELD.size + 2 * this.margin;
    this.scale = size / total;   // css px per inch
    this.size = size;
  }

  /** field (X, Y) -> canvas css px */
  toScreen(x, y) {
    return [(y + FIELD.half + this.margin) * this.scale, (x + FIELD.half + this.margin) * this.scale];
  }
  /** canvas css px -> field (X, Y) */
  toField(sx, sy) {
    return [sy / this.scale - FIELD.half - this.margin, sx / this.scale - FIELD.half - this.margin];
  }

  draw(world, opts = {}) {
    this.resize();
    const ctx = this.ctx;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.clearRect(0, 0, this.size, this.size);
    this.drawSurroundings(ctx, world);
    this.drawTiles(ctx);
    this.drawZones(ctx);
    this.drawFlowers(ctx, world);
    this.drawHiveFrame(ctx);
    this.drawBallsOnFloor(ctx, world);
    this.drawRobot(ctx, world, opts);
    this.drawHives(ctx, world);
    this.drawBallsInFlight(ctx, world);
    this.drawWalls(ctx);
    this.drawLabels(ctx, world);
    ctx.restore();
    if (this.sctx) this.drawSideView(world);
  }

  poly(ctx, pts) {
    ctx.beginPath();
    pts.forEach(([x, y], i) => { const [sx, sy] = this.toScreen(x, y); if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy); });
    ctx.closePath();
  }
  rect(ctx, r) { this.poly(ctx, [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]]); }
  circle(ctx, x, y, rIn) { const [sx, sy] = this.toScreen(x, y); ctx.beginPath(); ctx.arc(sx, sy, rIn * this.scale, 0, Math.PI * 2); }

  drawSurroundings(ctx, world) {
    ctx.fillStyle = '#1b1e24';
    ctx.fillRect(0, 0, this.size, this.size);
    // alliance areas (taped on the venue floor outside the field)
    for (const [alliance, area] of Object.entries(ALLIANCE_AREA)) {
      const r = { x0: area.x0, x1: area.x1, y0: Math.max(area.y0, -FIELD.half - this.margin + 1), y1: Math.min(area.y1, FIELD.half + this.margin - 1) };
      ctx.fillStyle = alliance === 'red' ? 'rgba(217,52,43,0.12)' : 'rgba(47,111,214,0.12)';
      this.rect(ctx, r); ctx.fill();
      ctx.strokeStyle = alliance === 'red' ? COLORS.red : COLORS.blue;
      ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = alliance === 'red' ? COLORS.red : COLORS.blue;
      ctx.font = `bold ${Math.max(10, this.scale * 5)}px system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const [lx, ly] = this.toScreen(0, alliance === 'red' ? -FIELD.half - this.margin / 2 : FIELD.half + this.margin / 2);
      ctx.save(); ctx.translate(lx, ly); ctx.rotate(alliance === 'red' ? -Math.PI / 2 : Math.PI / 2);
      ctx.fillText(`${alliance.toUpperCase()} ALLIANCE AREA`, 0, 0);
      ctx.fillText(`${world.nectarOffField[alliance]} NECTAR staged`, 0, this.scale * 6);
      ctx.restore();
    }
    // audience label
    ctx.fillStyle = '#9aa0a8';
    ctx.font = `${Math.max(10, this.scale * 4)}px system-ui, sans-serif`;
    const [ax, ay] = this.toScreen(FIELD.half + this.margin * 0.6, 0);
    ctx.fillText('AUDIENCE', ax, ay);
    const [bx, by] = this.toScreen(-FIELD.half - this.margin * 0.6, 0);
    ctx.fillText('REAR (scoring tags side)', bx, by);
  }

  drawTiles(ctx) {
    const [x0, y0] = this.toScreen(-FIELD.half, -FIELD.half);
    const s = FIELD.size * this.scale;
    ctx.fillStyle = COLORS.tile;
    ctx.fillRect(x0, y0, s, s);
    const t = FIELD.tile * this.scale;
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
      ctx.fillStyle = (i + j) % 2 ? COLORS.tileAlt : COLORS.tile;
      ctx.fillRect(x0 + j * t, y0 + i * t, t, t);
    }
    ctx.strokeStyle = COLORS.seam; ctx.lineWidth = 1;
    for (const v of TILE_SEAMS) {
      const [sx] = this.toScreen(0, v); const [, sy] = this.toScreen(v, 0);
      ctx.beginPath(); ctx.moveTo(sx, y0); ctx.lineTo(sx, y0 + s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x0, sy); ctx.lineTo(x0 + s, sy); ctx.stroke();
    }
    // field coordinate axes hint at the origin
    const [ox, oy] = this.toScreen(0, 0);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox, oy + 10 * this.scale); ctx.stroke(); // +X (toward audience)
    ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox + 10 * this.scale, oy); ctx.stroke(); // +Y
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = `${Math.max(8, this.scale * 2.6)}px system-ui`;
    ctx.fillText('+X', ox + 5, oy + 11 * this.scale); ctx.fillText('+Y', ox + 12 * this.scale, oy - 4);
  }

  drawZones(ctx) {
    for (const [alliance, z] of Object.entries(LOADING_ZONE)) {
      ctx.fillStyle = alliance === 'red' ? 'rgba(217,52,43,0.25)' : 'rgba(47,111,214,0.25)';
      this.rect(ctx, z); ctx.fill();
      ctx.strokeStyle = alliance === 'red' ? COLORS.red : COLORS.blue; ctx.lineWidth = Math.max(1.5, this.scale * 0.8); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = `${Math.max(8, this.scale * 2.4)}px system-ui`;
      ctx.textAlign = 'center';
      const [lx, ly] = this.toScreen((z.x0 + z.x1) / 2, (z.y0 + z.y1) / 2);
      ctx.save(); ctx.translate(lx, ly); ctx.rotate(-Math.PI / 2); ctx.fillText('LOADING ZONE', 0, 0); ctx.restore();
    }
    for (const [alliance, g] of Object.entries(GARDEN)) {
      ctx.fillStyle = alliance === 'red' ? COLORS.red : COLORS.blue;
      this.rect(ctx, g); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = `${Math.max(8, this.scale * 2.4)}px system-ui`;
      const [lx, ly] = this.toScreen(g.x0 - 3, (g.y0 + g.y1) / 2);
      ctx.fillText('GARDEN', lx, ly);
    }
  }

  drawFlowers(ctx, world) {
    for (const fl of world.flowers) {
      const f = fl.spec;
      const [wx, wy] = f.wall;
      const along = FLOWER.footprintAlongWall / 2, deep = FLOWER.footprintDepth / 2;
      const cx = wx !== 0 ? wx * (FIELD.half - deep) : f.x;
      const cy = wy !== 0 ? wy * (FIELD.half - deep) : f.y;
      const ax = wy !== 0 ? along : deep, ay = wx !== 0 ? along : deep;
      ctx.fillStyle = '#3f8f4f';
      this.poly(ctx, [[cx - ax, cy - ay], [cx + ax, cy - ay], [cx + ax, cy + ay], [cx - ax, cy + ay]]); ctx.fill();
      ctx.strokeStyle = '#1e5a2a'; ctx.lineWidth = 1; ctx.stroke();
      // opening
      ctx.fillStyle = '#183a20';
      this.circle(ctx, f.x, f.y, FLOWER.openingDiameter / 2); ctx.fill();
      // stack contents as a mini column beside it
      const n = fl.stack.length;
      ctx.font = `bold ${Math.max(9, this.scale * 2.8)}px system-ui`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = COLORS.text;
      const [tx, ty] = this.toScreen(f.x - wx * 9, f.y - wy * 9);
      ctx.fillText(`FLOWER ${n}`, tx, ty);
      fl.stack.forEach((b, i) => {
        const col = b.kind === 'pollen' ? COLORS.pollen : (b.alliance === 'red' ? COLORS.nectarRed : COLORS.nectarBlue);
        ctx.fillStyle = col;
        const [bx, by] = this.toScreen(f.x - wx * (5 + i * 2.2) + (wx === 0 ? 0 : 0), f.y - wy * (5 + i * 2.2));
        // draw stacked dots perpendicular to the wall
        ctx.beginPath(); ctx.arc(bx + (wy !== 0 ? 0 : 0), by, Math.max(2, this.scale * 0.9), 0, Math.PI * 2); ctx.fill();
      });
    }
  }

  drawHiveFrame(ctx) {
    const f = HIVE.frame;
    ctx.strokeStyle = '#3b3f46'; ctx.lineWidth = Math.max(2, f.footBarWidth * this.scale);
    for (const sy of [-1, 1]) {
      const [a, b] = this.toScreen(-f.footBarHalfLength, sy * f.footBarY);
      const [c, d] = this.toScreen(f.footBarHalfLength, sy * f.footBarY);
      ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke();
    }
    ctx.lineWidth = Math.max(1.5, 1.2 * this.scale); ctx.strokeStyle = '#4a4f57';
    for (let i = 0; i < 4; i++) {
      const [a, b] = this.toScreen(...f.legBase[i]);
      const [c, d] = this.toScreen(...f.legTop[i]);
      ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke();
    }
    // crossbar at the pivots (top of the frame)
    const [a, b] = this.toScreen(0, -12.4), [c, d] = this.toScreen(0, 12.4);
    ctx.strokeStyle = '#5a5f68'; ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke();
  }

  drawHives(ctx, world) {
    const c = HIVE.cell;
    for (const alliance of ['red', 'blue']) {
      const h = world.hives[alliance];
      const cy = HIVE.centerY[alliance];
      // animate a tip: interpolate the "up side" position
      let upSide = h.upSide;
      let t = 0;
      if (h.tipping) t = h.tipping.t / h.tipping.duration;
      const color = alliance === 'red' ? COLORS.red : COLORS.blue;
      for (const side of [-1, 1]) {
        const isUp = side === upSide;
        // footprint of the CELL in X: from the pivot outward
        const aMin = c.aIn, aMax = c.aOut;
        const pIn = hiveBodyToField(0, isUp ? aMin : -aMin, 0, cy, upSide);
        const pOut = hiveBodyToField(0, isUp ? aMax : -aMax, 0, cy, upSide);
        let x0 = pIn.x, x1 = pOut.x;
        if (h.tipping) { // swing toward the pivot while tipping
          const k = 1 - Math.abs(Math.cos(t * Math.PI));
          x0 *= (1 - k * 0.7); x1 *= (1 - k * 0.7);
        }
        const hw = c.width / 2;
        ctx.fillStyle = isUp ? color : shade(color, -0.45);
        ctx.globalAlpha = isUp ? 0.95 : 0.8;
        this.poly(ctx, [[x0, cy - hw], [x1, cy - hw], [x1, cy + hw], [x0, cy + hw]]); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = shade(color, -0.6); ctx.lineWidth = 1.5; ctx.stroke();
        // mouth marker on the up CELL
        if (isUp) {
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
          const [mx0, my0] = this.toScreen(x1, cy - hw + 1), [mx1, my1] = this.toScreen(x1, cy + hw - 1);
          ctx.beginPath(); ctx.moveTo(mx0, my0); ctx.lineTo(mx1, my1); ctx.stroke();
          ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.max(9, this.scale * 2.6)}px system-ui`; ctx.textAlign = 'center';
          const [lx, ly] = this.toScreen((x0 + x1) / 2, cy);
          ctx.fillText(`${alliance.toUpperCase()} CELL ${h.tipping ? 'TIPPING' : 'UP'}`, lx, ly - this.scale * 1.6);
          ctx.fillText(`${h.upCell.length} in · ${world.cellMass(h).toFixed(1)}/${world.opts.tipMass}`, lx, ly + this.scale * 1.8);
        } else {
          // AprilTag cluster on the down CELL's bottom face (visible from below)
          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          const cl = HIVE.clusters.find((k) => k.alliance === alliance && k.side === side);
          const mid = (x0 + x1) / 2;
          for (let s = 0; s < 4; s++) {
            const [tx, ty] = this.toScreen(mid, cy + HIVE.tagSlotOffsets[s]);
            const r = Math.max(2, 1.6 * this.scale);
            ctx.fillRect(tx - r / 2, ty - r / 2, r, r);
          }
          ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = `${Math.max(8, this.scale * 2.2)}px system-ui`; ctx.textAlign = 'center';
          const [lx, ly] = this.toScreen(mid, cy);
          ctx.fillText(`tags ${cl.ids[0]}-${cl.ids[3]}`, lx, ly + this.scale * 4);
        }
      }
      // pivot
      const [px, py] = this.toScreen(0, cy);
      ctx.fillStyle = '#eee'; ctx.beginPath(); ctx.arc(px, py, Math.max(2, this.scale * 0.8), 0, Math.PI * 2); ctx.fill();
    }
  }

  ballColor(b) { return b.kind === 'pollen' ? COLORS.pollen : (b.alliance === 'red' ? COLORS.nectarRed : COLORS.nectarBlue); }

  drawBallsOnFloor(ctx, world) {
    for (const b of world.balls) {
      if (b.state !== 'floor') continue;
      ctx.fillStyle = this.ballColor(b);
      this.circle(ctx, b.x, b.y, b.r); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.stroke();
    }
  }

  drawBallsInFlight(ctx, world) {
    for (const b of world.balls) {
      if (b.state !== 'flight') continue;
      // shadow on the floor
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      this.circle(ctx, b.x, b.y, b.r); ctx.fill();
      // the ball, lifted "toward the audience" and enlarged with height
      const lift = b.z * 0.35;
      const [sx, sy] = this.toScreen(b.x + lift, b.y);
      const rad = b.r * this.scale * (1 + b.z / 90);
      ctx.fillStyle = this.ballColor(b);
      ctx.beginPath(); ctx.arc(sx, sy, rad, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = `${Math.max(8, this.scale * 2)}px system-ui`; ctx.textAlign = 'center';
      ctx.fillText(`${b.z.toFixed(0)}"`, sx, sy - rad - 2);
    }
  }

  drawRobot(ctx, world, opts) {
    const rb = world.robot;
    const L = ROBOT_BODY.length, W = ROBOT_BODY.width;
    // start footprint
    const sp = world.startPose;
    const startCorners = robotCorners(sp.x, sp.y, sp.headingDeg * Math.PI / 180, L, W);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.setLineDash([4, 3]); ctx.lineWidth = 1;
    this.poly(ctx, startCorners); ctx.stroke(); ctx.setLineDash([]);
    // trail
    if (this.showTrail) {
      this.trail.push([rb.x, rb.y]);
      if (this.trail.length > 600) this.trail.shift();
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1;
      ctx.beginPath();
      this.trail.forEach(([x, y], i) => { const [sx, sy] = this.toScreen(x, y); if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy); });
      ctx.stroke();
    }
    // sensor rays
    if (this.showFov && world.visionEnabled) {
      const cam = findSensor('Webcam 1');
      const c = Math.cos(rb.heading), s = Math.sin(rb.heading);
      const cx = rb.x + cam.offset[0] * c, cy = rb.y + cam.offset[0] * s;
      const half = cam.hfovDeg / 2 * Math.PI / 180;
      const range = 90;
      ctx.fillStyle = 'rgba(120,200,255,0.12)';
      this.poly(ctx, [[cx, cy], [cx + range * Math.cos(rb.heading - half), cy + range * Math.sin(rb.heading - half)],
        [cx + range * Math.cos(rb.heading + half), cy + range * Math.sin(rb.heading + half)]]);
      ctx.fill();
    }
    {
      const d = findSensor('sensor_distance');
      const c = Math.cos(rb.heading), s = Math.sin(rb.heading);
      const ox = rb.x + d.offset[0] * c, oy = rb.y + d.offset[0] * s;
      const dist = Math.min(opts.distanceReading ?? 0, d.maxRange);
      if (dist > 0) {
        const [a, b] = this.toScreen(ox, oy), [e, f] = this.toScreen(ox + dist * c, oy + dist * s);
        ctx.strokeStyle = 'rgba(255,80,80,0.7)'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(e, f); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    // body
    const corners = robotCorners(rb.x, rb.y, rb.heading, L, W);
    ctx.fillStyle = world.alliance === 'red' ? '#7a2b26' : '#274d8f';
    this.poly(ctx, corners); ctx.fill();
    ctx.strokeStyle = COLORS.robotEdge; ctx.lineWidth = 2; ctx.stroke();
    // wheels
    const c = Math.cos(rb.heading), s = Math.sin(rb.heading);
    const wheelPos = [[6, 7], [6, -7], [-6, 7], [-6, -7]];
    ctx.fillStyle = '#111';
    for (const [lx, ly] of wheelPos) {
      const wc = robotCorners(rb.x + lx * c - ly * s, rb.y + lx * s + ly * c, rb.heading, 4, 1.6);
      this.poly(ctx, wc); ctx.fill();
    }
    // intake mouth (front) and launcher
    const front = robotCorners(rb.x + 8.5 * c, rb.y + 8.5 * s, rb.heading, 1.5, 14);
    ctx.fillStyle = '#e0a020'; this.poly(ctx, front); ctx.fill();
    const barrel = robotCorners(rb.x + 3 * c, rb.y + 3 * s, rb.heading, 8, 3);
    ctx.fillStyle = '#556'; this.poly(ctx, barrel); ctx.fill();
    // magazine balls
    rb.magazine.forEach((b, i) => {
      const lx = -6 + (i % 2) * 3.2, ly = -3 + Math.floor(i / 2) * 3.2 + 1.5;
      const px = rb.x + lx * c - ly * s, py = rb.y + lx * s + ly * c;
      ctx.fillStyle = this.ballColor(b); this.circle(ctx, px, py, b.r * 0.9); ctx.fill();
    });
    // heading arrow
    const [ax, ay] = this.toScreen(rb.x, rb.y), [bx, by] = this.toScreen(rb.x + 12 * c, rb.y + 12 * s);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    if (rb.frontContact) { ctx.fillStyle = '#ff5050'; ctx.beginPath(); ctx.arc(bx, by, 4, 0, Math.PI * 2); ctx.fill(); }
  }

  drawWalls(ctx) {
    ctx.strokeStyle = COLORS.wallTop; ctx.lineWidth = Math.max(3, FIELD.wallThickness * this.scale * 2);
    const [x0, y0] = this.toScreen(-FIELD.half, -FIELD.half);
    const s = FIELD.size * this.scale;
    ctx.strokeRect(x0, y0, s, s);
    ctx.fillStyle = COLORS.red; ctx.font = `bold ${Math.max(9, this.scale * 3)}px system-ui`; ctx.textAlign = 'center';
    ctx.save(); ctx.translate(x0 - 8, y0 + s / 2); ctx.rotate(-Math.PI / 2); ctx.fillText('RED WALL', 0, 0); ctx.restore();
    ctx.fillStyle = COLORS.blue;
    ctx.save(); ctx.translate(x0 + s + 8, y0 + s / 2); ctx.rotate(Math.PI / 2); ctx.fillText('BLUE WALL', 0, 0); ctx.restore();
  }

  drawLabels(ctx, world) {
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.font = `${Math.max(9, this.scale * 2.6)}px system-ui`; ctx.textAlign = 'left';
    const rb = world.robot;
    const [sx, sy] = this.toScreen(-FIELD.half - this.margin + 2, -FIELD.half - this.margin + 2);
    ctx.fillText(`robot X ${rb.x.toFixed(1)}  Y ${rb.y.toFixed(1)}  heading ${(rb.heading * 180 / Math.PI).toFixed(0)}°   t=${world.time.toFixed(1)}s`, sx, sy + 10);
  }

  // ---- HIVE side view ---------------------------------------------------------------
  drawSideView(world) {
    const cv = this.sideCanvas, ctx = this.sctx;
    const dpr = window.devicePixelRatio || 1;
    const rect = cv.getBoundingClientRect();
    const w = Math.max(100, Math.floor(rect.width)), h = Math.max(60, Math.floor(rect.height));
    if (cv.width !== Math.floor(w * dpr)) { cv.width = Math.floor(w * dpr); cv.height = Math.floor(h * dpr); }
    ctx.save(); ctx.scale(dpr, dpr);
    ctx.fillStyle = '#1b1e24'; ctx.fillRect(0, 0, w, h);
    // X from -75 (rear, left) to +75 (audience, right); Z from 0 to 75
    const xs = w / 150, zs = (h - 14) / 75;
    const toS = (x, z) => [(x + 75) * xs, h - 10 - z * zs];
    // floor
    ctx.fillStyle = COLORS.tile; ctx.fillRect(0, h - 10, w, 10);
    const alliance = world.alliance;
    const hv = world.hives[alliance];
    const cy = HIVE.centerY[alliance];
    const c = HIVE.cell;
    const color = alliance === 'red' ? COLORS.red : COLORS.blue;
    // frame legs
    ctx.strokeStyle = '#4a4f57'; ctx.lineWidth = 2;
    for (const sx of [-1, 1]) {
      const [a, b] = toS(sx * 18.95, 0), [d, e] = toS(0, HIVE.frame.legTopZ);
      ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(d, e); ctx.stroke();
    }
    // cells as parallelograms in the X-Z plane
    const pent = cellPentagon();
    const bMin = c.b0, bMax = c.b0 + c.height;
    for (const side of [-1, 1]) {
      const isUp = side === hv.upSide;
      const aIn = isUp ? c.aIn : -c.aOut, aOut = isUp ? c.aOut : -c.aIn;
      const pts = [[aIn, bMin], [aOut, bMin], [aOut, bMax], [aIn, bMax]].map(([a, b]) => hiveBodyToField(0, a, b, cy, hv.upSide));
      ctx.fillStyle = isUp ? color : shade(color, -0.45);
      ctx.beginPath(); pts.forEach((p, i) => { const [sx, sy] = toS(p.x, p.z); if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy); }); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#111'; ctx.lineWidth = 1; ctx.stroke();
      if (isUp) {
        const m = pts[1], t = pts[2];
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(...toS(m.x, m.z)); ctx.lineTo(...toS(t.x, t.z)); ctx.stroke();
      }
    }
    // arm + pivot
    const pa = hiveBodyToField(0, -c.aOut, 0, cy, hv.upSide), pb = hiveBodyToField(0, c.aOut, 0, cy, hv.upSide);
    ctx.strokeStyle = '#ccc'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(...toS(pa.x, pa.z)); ctx.lineTo(...toS(pb.x, pb.z)); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(...toS(0, HIVE.pivotZ), 3, 0, Math.PI * 2); ctx.fill();
    // balls in flight (any Y) projected on X-Z
    for (const b of world.balls) {
      if (b.state !== 'flight') continue;
      ctx.fillStyle = this.ballColor(b);
      ctx.beginPath(); ctx.arc(...toS(b.x, b.z), Math.max(2, b.r * xs), 0, Math.PI * 2); ctx.fill();
    }
    // robot as a box
    const rb = world.robot;
    const rx = rb.x, half = ROBOT_BODY.length / 2;
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    const [r0, rz] = toS(rx - half, ROBOT_BODY.height);
    ctx.fillRect(r0, rz, ROBOT_BODY.length * xs, ROBOT_BODY.height * zs);
    ctx.fillStyle = '#ccc'; ctx.font = '10px system-ui'; ctx.textAlign = 'left';
    ctx.fillText(`${alliance.toUpperCase()} HIVE side view (X-Z). Lip 53.5", top 65.6", pivot 43.95"`, 4, 11);
    ctx.textAlign = 'right'; ctx.fillText('audience →', w - 4, 11);
    ctx.restore();
  }
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = (v) => Math.max(0, Math.min(255, Math.round(v + (amt < 0 ? v * amt : (255 - v) * amt))));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
