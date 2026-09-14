import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FIELD, HIVE, FLOWER, LOADING_ZONE, GARDEN, POLLEN, NECTAR, NECTAR_POLLEN_EQUIV,
  fieldToHiveBody, hiveBodyToField, upCellMouthCenter, cellPentagon, pointInPolygon, robotObstacles, wallPolygons,
} from '../src/field/geometry.js';
import { POINTS, MATCH, scoreFlower } from '../src/field/rules.js';

test('field is 144 in square made of 24 in tiles (manual 9.1)', () => {
  assert.equal(FIELD.size, 144);
  assert.equal(FIELD.tile * FIELD.tilesPerSide, FIELD.size);
  assert.equal(FIELD.half, 72);
});

test('scoring elements match the published sizes', () => {
  assert.equal(POLLEN.diameter, 2.8);
  assert.equal(NECTAR.diameter, 3.62);
  assert.ok(NECTAR_POLLEN_EQUIV > 1.6 && NECTAR_POLLEN_EQUIV < 1.7);
});

test('HIVE CELL body frame reproduces the published lip and top heights', () => {
  const c = HIVE.cell;
  const lip = hiveBodyToField(0, c.aOut, c.b0, HIVE.centerY.red, 1);
  const top = hiveBodyToField(0, c.aOut, c.b0 + c.height, HIVE.centerY.red, 1);
  assert.ok(Math.abs(lip.z - c.lipZ) < 0.05, `lip z ${lip.z}`);
  assert.ok(Math.abs(top.z - c.topZ) < 0.05, `top z ${top.z}`);
  assert.equal(lip.y, HIVE.centerY.red);
  assert.ok(lip.x > 0, 'red up CELL faces the audience (+X) at the start');
});

test('field <-> HIVE body transforms are inverses', () => {
  for (const [x, y, z] of [[10, -5, 50], [-30, 20, 12], [0, -12.75, 43.95]]) {
    for (const up of [1, -1]) {
      const b = fieldToHiveBody(x, y, z, HIVE.centerY.blue, up);
      const f = hiveBodyToField(b.w, b.a, b.b, HIVE.centerY.blue, up);
      assert.ok(Math.abs(f.x - x) < 1e-9 && Math.abs(f.y - y) < 1e-9 && Math.abs(f.z - z) < 1e-9);
    }
  }
});

test('the two HIVEs are 25.5 in apart and mirror each other', () => {
  assert.equal(HIVE.centerY.blue - HIVE.centerY.red, 25.5);
  assert.equal(HIVE.startUpSide.red, -HIVE.startUpSide.blue);
  const m = upCellMouthCenter('red', 1);
  assert.ok(m.z > HIVE.cell.lipZ && m.z < HIVE.cell.topZ);
});

test('CELL pentagon is 20 in wide and 14 in tall', () => {
  const p = cellPentagon();
  const xs = p.map((v) => v[0]), ys = p.map((v) => v[1]);
  assert.equal(Math.max(...xs) - Math.min(...xs), 20);
  assert.ok(Math.abs(Math.max(...ys) - Math.min(...ys) - 14) < 1e-9);
  assert.ok(pointInPolygon(0, HIVE.cell.b0 + 5, p));
  assert.ok(!pointInPolygon(11, HIVE.cell.b0 + 5, p));
});

test('four FLOWERs sit on the perimeter, one per wall', () => {
  assert.equal(FLOWER.list.length, 4);
  const walls = new Set(FLOWER.list.map((f) => f.wall.join(',')));
  assert.equal(walls.size, 4);
  for (const f of FLOWER.list) {
    const onWall = Math.abs(Math.abs(f.x) - 72) < 3 || Math.abs(Math.abs(f.y) - 72) < 3;
    assert.ok(onWall, f.name);
  }
  assert.equal(FLOWER.openingDiameter, 4);
  assert.equal(FLOWER.openingZ, 21.5);
});

test('LOADING ZONE is 23 x 11 in against the alliance wall; GARDEN is a 23 x 2 in strip', () => {
  for (const z of Object.values(LOADING_ZONE)) {
    assert.ok(Math.abs((z.x1 - z.x0) - 24) <= 1 && Math.abs((z.y1 - z.y0) - 11) < 1e-9);
    assert.ok(Math.abs(z.y0) === 72 || Math.abs(z.y1) === 72);
  }
  for (const g of [GARDEN.red, GARDEN.blue]) {
    assert.ok(Math.abs((g.x1 - g.x0) - 2) < 1e-9 && Math.abs((g.y1 - g.y0) - 24) <= 1);
  }
});

test('AprilTag IDs 30-45, four per CELL', () => {
  const ids = HIVE.clusters.flatMap((c) => c.ids).sort((a, b) => a - b);
  assert.deepEqual(ids, Array.from({ length: 16 }, (_, i) => 30 + i));
  assert.equal(HIVE.tagSize, 3.25);
});

test('robot obstacles include walls, HIVE legs, foot bars and FLOWERs', () => {
  const obs = robotObstacles(18);
  assert.ok(obs.filter((o) => o.name === 'HIVE leg').length === 4);
  assert.ok(obs.filter((o) => o.name === 'HIVE foot bar').length === 2);
  assert.ok(obs.filter((o) => o.name.startsWith('FLOWER')).length === 4);
  assert.equal(wallPolygons().length, 4);
});

test('scoring table (10-2) and match timing', () => {
  assert.equal(POINTS.hiveTip, 20);
  assert.equal(POINTS.leave, 3);
  assert.equal(POINTS.parkAuto, 5);
  assert.equal(MATCH.autoSeconds, 30);
  assert.equal(MATCH.teleopSeconds, 120);
  // FLOWER: owner is the alliance with the top NECTAR; bottom NECTAR bonus
  const s = scoreFlower([{ kind: 'nectar', alliance: 'red' }, { kind: 'pollen' }, { kind: 'nectar', alliance: 'blue' }]);
  assert.equal(s.red, 5);
  assert.equal(s.blue, 3 * 2);
  assert.deepEqual(scoreFlower([{ kind: 'pollen' }]), { red: 0, blue: 0 });
});
