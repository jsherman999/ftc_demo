# BIOBUZZ field model

All numbers in inches, in the official **FTC Field Coordinate System**
(ftc-docs, "Field Coordinate System Definition"):

* origin at the centre of the field on the top surface of the tiles, **+Z up**
* the red ALLIANCE AREA is on the **left as seen from the audience** (the same
  "inverted" square layout DECODE used), so **+Y** runs from the red wall toward
  the blue wall and **+X** runs toward the audience
* headings are counter-clockwise from +X (facing the blue wall = +90°)

Source: 2026-2027 Competition Manual V1 (12 Sep 2026), Section 9 ARENA
(page 63 onward) and Section 10; Event Field Setup Guide V1.0. Values marked
*(figure)* were measured from manual figures rather than printed.

## Field and perimeter (9.1)

| Item | Value |
| --- | --- |
| Playing surface | 144 × 144 nominal (general tolerance ± 1 in) |
| Tiles | 36 soft foam tiles, 24 × 24 × 0.59 |
| Perimeter height above the tiles | ≈ 11.5 (12.125 in wall minus the tile) |
| Wall thickness | 1.0 |

## Scoring elements (9.2)

| Element | Diameter | Mass | Colour |
| --- | --- | --- | --- |
| POLLEN | 2.80 | 24.9 g | yellow; 40 per match, either alliance may use them |
| NECTAR | 3.62 | 41.3 g | red or blue; 8 per alliance, only that alliance may control them |

## ALLIANCE AREA, LOADING ZONE, GARDEN (9.3, 9.4)

| Zone | Extent |
| --- | --- |
| Red ALLIANCE AREA | outside the red wall: X ∈ [−48.5, 48.5], Y ∈ [−126, −72] (97 × 54) |
| Blue ALLIANCE AREA | outside the blue wall: X ∈ [−48.5, 48.5], Y ∈ [72, 126] |
| Red LOADING ZONE | X ∈ [−48, −24], Y ∈ [−72, −61] (23 × 11, against the red wall, rear half) |
| Blue LOADING ZONE | X ∈ [24, 48], Y ∈ [61, 72] |
| Red GARDEN | X ∈ [68, 70], Y ∈ [−72, −48] (2 in tape, 23 in long, audience-side corner by the red wall) |
| Blue GARDEN | X ∈ [−70, −68], Y ∈ [48, 72] (rear corner by the blue wall) |

## FLOWERs (9.5)

Four perimeter-mounted FLOWERs, one per wall, each centred on a tile seam
24 in from a corner. Top opening 4.0 in diameter, 21.5 in above the tiles;
retrieval opening at the bottom facing the field. Footprint ≈ 5.9 in along the
wall × 4.8 in deep; the pipe axis is ≈ 2.3 in inside the wall face *(figure)*.

| FLOWER | Centre (X, Y) | Wall |
| --- | --- | --- |
| 0 | (−69.7, −24) | rear wall, red side |
| 1 | (−24, 69.7) | blue wall, rear side |
| 2 | (69.7, 24) | audience wall, blue side |
| 3 | (24, −69.7) | red wall, audience side |

Each FLOWER starts with 4 POLLEN. Scoring volume is 17 in tall.

## HIVE structure (9.6)

Two bi-stable HIVEs share one frame at the centre of the field. Their pivot
axes are parallel to Y at X = 0, **43.95 in** above the tiles, **25.5 in**
apart: red HIVE at Y = −12.75, blue HIVE at Y = +12.75.

Each HIVE is a rigid arm tilted **30°** with a CELL at each end. In the HIVE
body frame (a along the arm toward the upward CELL, b perpendicular "up", w
across the CELL):

| Item | Value |
| --- | --- |
| CELL extent along the arm | a ∈ [9.42, 21.46] (open mouth at a = 21.46) |
| CELL cross-section | pentagon 20 wide × 14 tall, 7.61 to the shoulders |
| Base of the pentagon below the arm line | b₀ = −1.3625 (derived so the lip lands at 53.5) |
| Upward CELL mouth lip / top | **53.5** / **65.6** above the tiles (published) |
| Down CELL lowest point | ≈ 30.65 (robots ≤ 29 in pass underneath) |
| Frame footprint | 49.46 (Y) × 38.95 (X) |
| Foot bars | parallel to X at Y = ±24, 38.95 long, 1.46 wide |
| Leg bases | (±18.95, ±23.9), leaning to (0, ±12.4) at z 42.45 *(figure)* |
| Start position | red upward CELL faces the audience (+X); blue faces the rear (−X). 3 NECTAR staged in each upward CELL. |

A TIP swaps which CELL is up (20 points) and dumps the contents on the floor
on the side that was up. The mass that tips a HIVE is not published; the
simulator uses 8 POLLEN-equivalents (NECTAR = 1.65) and lets you change it.

## AprilTags (9.9)

Family 36h11, 3.25 in tags, four per cluster on the **bottom face of every
CELL**, tag centres at −6.5, −2.75, +2.75, +6.5 in across the CELL.

| IDs | CELL |
| --- | --- |
| 30–33 | red CELL opposite the audience ("RED SCORING") |
| 34–37 | red CELL on the audience side ("RED AUDIENCE") |
| 38–41 | blue CELL on the audience side ("BLUE AUDIENCE") |
| 42–45 | blue CELL opposite the audience ("BLUE SCORING") |

Because the HIVEs pivot, a tag's field pose depends on the HIVE state: use
them to aim at a CELL, not for absolute localisation. The simulator reports
one `AprilTagClusterDetection` per visible CELL (origin at the centre of the
cluster) plus `AprilTagSingleDetection`s for the tags in view.

## Robot starting positions

Robots start touching their alliance wall, outside the LOADING ZONE and
FLOWERs, with up to 4 POLLEN preloaded. The simulator offers an audience-side
and a rear-side start for each alliance.

## Match (Section 10)

| Item | Value |
| --- | --- |
| AUTO / transition / TELEOP | 30 s / 8 s / 120 s |
| LEAVE (AUTO) | 3 |
| PARK in the LOADING ZONE (end of AUTO, end of MATCH) | 5 each |
| HIVE TIP | 20 |
| Element left in the upward CELL at the end | 2 |
| FLOWER: alliance NECTAR at the bottom | 5 |
| FLOWER: each element in a FLOWER the alliance owns (top NECTAR) | 2 (last 60 s only) |
| Element in the alliance GARDEN | 1 |
| Possession limit | 4 |
| NECTAR unlock | one staged NECTAR per TIP through the LOADING ZONE; all remaining with 60 s left |
