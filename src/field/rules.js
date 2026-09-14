// BIOBUZZ match timing and scoring (Competition Manual V1, Section 10,
// Tables 10-2 and 10-3). Values the manual does not publish (how much mass tips
// a HIVE) are marked ASSUMPTION and can be changed in the simulator settings.

export const MATCH = Object.freeze({
  autoSeconds: 30,          // AUTO period
  transitionSeconds: 8,     // pause between AUTO and TELEOP at events
  teleopSeconds: 120,       // TELEOP period
  flowerScoringWindow: 60,  // FLOWER scoring only counts in the last 60 s of TELEOP
  nectarFloodAt: 60,        // remaining NECTAR may be loaded with 60 s left
});

export const POINTS = Object.freeze({
  leave: 3,                 // ROBOT leaves its starting location during AUTO
  parkAuto: 5,              // ROBOT in its LOADING ZONE at the end of AUTO
  parkTeleop: 5,            // ROBOT in its LOADING ZONE at the end of the MATCH
  hiveTip: 20,              // each HIVE TIP
  cellElement: 2,           // each element left in the upward CELL at the end
  flowerBottomNectar: 5,    // alliance NECTAR at the bottom of a FLOWER
  flowerOwnedElement: 2,    // each element in a FLOWER the alliance owns (top NECTAR)
  gardenElement: 1,         // each element in the alliance GARDEN
  minorFoul: 5,
  majorFoul: 20,
});

export const LIMITS = Object.freeze({
  possession: 4,            // max scoring elements a ROBOT may CONTROL at once
  robotSizeIn: 18,          // 18 x 18 x 18 in starting configuration
  robotMaxHeightIn: 29,     // expanded height limit (R105)
  nectarPerTip: 1,          // one staged NECTAR may be loaded per HIVE TIP (G426)
  nectarStagedInCell: 3,    // NECTAR in each upward CELL at the start
  nectarOffField: 5,        // NECTAR staged in each ALLIANCE AREA
});

export const ASSUMPTIONS = Object.freeze({
  // The manual describes the HIVE as bi-stable; the mass needed to tip it is
  // not published. 8 pollen-equivalents lets 4 NECTAR (~6.6) plus one POLLEN
  // tip the first time, and one full robot load (4 POLLEN) after that.
  tipMassPollenEquiv: 8,
  tipDurationSeconds: 1.2,
});

/** Score one FLOWER stack. stack = [{kind:'pollen'|'nectar', alliance}] bottom first. */
export function scoreFlower(stack) {
  const pts = { red: 0, blue: 0 };
  const nectars = stack.filter((e) => e.kind === 'nectar');
  if (nectars.length === 0) return pts;
  pts[nectars[0].alliance] += POINTS.flowerBottomNectar;
  const owner = nectars[nectars.length - 1].alliance;
  pts[owner] += POINTS.flowerOwnedElement * stack.length;
  return pts;
}

/** Tally the score for one alliance from a summary of the world state. Returns points per category. */
export function tallyAlliance(s) {
  const pts = {
    leavePoints: s.left ? POINTS.leave : 0,
    parkAutoPoints: s.parkedAuto ? POINTS.parkAuto : 0,
    parkTeleopPoints: s.parkedTeleop ? POINTS.parkTeleop : 0,
    tipPoints: s.tips * POINTS.hiveTip,
    cellPoints: s.cellElements * POINTS.cellElement,
    flowerPoints: s.flowerPoints,
    gardenPoints: s.gardenElements * POINTS.gardenElement,
  };
  pts.total = Object.values(pts).reduce((a, v) => a + v, 0);
  return pts;
}
