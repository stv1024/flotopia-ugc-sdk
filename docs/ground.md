# ground.json by example: a two-storey house

A house of two storeys with a stair inside, a door, a balcony door and a balcony; outside a bench you may stand
on and a planter you may not. It is [`templates/house`](../templates/house): build it, `pack`, `serve`, open it
in the UGC browser with `&play&debug=ground` (AGENTS.md) and walk it. The rules it shows are in
[`city.md`](city.md) section 2; the format is [`abi.md`](abi.md) 2.3.

**Make the meshes and the ground from the same numbers.** `build.mjs` keeps one list of parts; each part is a
box that makes its mesh and its cell or collider. A door cut in the wall's mesh is then cut in its collider too.
(The commonest fault in the pilot: a wall's collider whole over the door in its mesh. `check` cannot see it;
walking can: see "Walk it" below.)

## The house

The deck is at `y = 0.5`; the upper floor's top at 3.5 (3 m a storey); the walls go to 6.5, a roof slab on top.
The house is `x −5..5`, `z −4..4`; its front, with the door, faces `+z` (the island's front).

```
            x = −5                               x = 5
  z = −4    ┌─────────────────────────────────────┐  back wall
            │                                     │
  z = −0.88 │▓▓│ ← the stair's top                │
            │▓▓│   11 steps, up toward −z         │
            │▓▓│   x −4.8..−3.8, a rail beside it  │
  z = 2.2   │▓▓│ ← its first step                 │
            │      (the landing: the way on)      │
  z = 4     └────────────────┐   ┌────────────────┘  front wall
                            door (x −0.6..0.6)
                    (upstairs: the balcony door at x 2..3.2, the balcony in front)
```

## The whole ground.json

The cells:

| # | what | top (`h.const`) |
|---|---|---|
| 0 | the deck: the whole footprint, inside the house too (the ground floor is the deck) | 0.5 |
| 1–11 | the steps: 0.28 m deep, 0.25 m up each | 0.75 … 3.25 |
| 12–14 | the upper floor in three pieces round the stairwell (a cell has no holes): A right of it, B past its top, C over its foot | 3.5 |
| 15 | the balcony | 3.5 |

The colliders:

| # | what | y0 .. y1 |
|---|---|---|
| 0–2 | back, left, right walls: no openings, so each is **one** collider from the deck to the roof | 0.5 .. 6.5 |
| 3, 4 | the front wall downstairs, left and right of the door | 0.5 .. 3.5 |
| 5 | the lintel over the door (its bottom over feet + 1.9 = 2.4: not a wall for the player) | 2.7 .. 3.5 |
| 6–8 | the front wall upstairs, left and right of the balcony door, the lintel | 3.5 .. 6.5, 5.7 .. 6.5 |
| 9 | the roof slab: keeps the follow camera's arm in the upper room | 6.5 .. 6.75 |
| 10 | the stair's rail, from the deck to 1.1 m over the upper floor: a wall downstairs (no way into the stair from the side) and upstairs (no fall into the stairwell) | 0.5 .. 4.6 |
| 11–13 | the upper floor's slab (the same three pieces as its cells): its bottom is over feet + 1.9 downstairs, so no wall there; it keeps the follow camera under the ceiling downstairs and over the floor upstairs | 3.3 .. 3.5 |
| 14 | upstairs, a rail across the stairwell's foot end | 3.5 .. 4.6 |
| 15 | the balcony's slab | 3.3 .. 3.5 |
| 16–18 | the balcony's rail, 1.1 m: more than a step (0.62), so a wall | 3.5 .. 4.6 |
| 19 | the bench, 0.45 m: under a step, so the player walks onto it | 0.5 .. 0.95 |
| 20 | the planter: its mesh is 0.8 m, its collider 1.9 m, more than a jump reaches | 0.5 .. 2.4 |

```json
{
  "cells": [
    {"poly": [[-12, -12], [12, -12], [12, 12], [-12, 12]], "h": {"const": 0.5}, "surf": "deck"},
    {"poly": [[-4.8, 1.92], [-3.8, 1.92], [-3.8, 2.2], [-4.8, 2.2]], "h": {"const": 0.75}, "surf": "wood"},
    {"poly": [[-4.8, 1.64], [-3.8, 1.64], [-3.8, 1.92], [-4.8, 1.92]], "h": {"const": 1}, "surf": "wood"},
    {"poly": [[-4.8, 1.36], [-3.8, 1.36], [-3.8, 1.64], [-4.8, 1.64]], "h": {"const": 1.25}, "surf": "wood"},
    {"poly": [[-4.8, 1.08], [-3.8, 1.08], [-3.8, 1.36], [-4.8, 1.36]], "h": {"const": 1.5}, "surf": "wood"},
    {"poly": [[-4.8, 0.8], [-3.8, 0.8], [-3.8, 1.08], [-4.8, 1.08]], "h": {"const": 1.75}, "surf": "wood"},
    {"poly": [[-4.8, 0.52], [-3.8, 0.52], [-3.8, 0.8], [-4.8, 0.8]], "h": {"const": 2}, "surf": "wood"},
    {"poly": [[-4.8, 0.24], [-3.8, 0.24], [-3.8, 0.52], [-4.8, 0.52]], "h": {"const": 2.25}, "surf": "wood"},
    {"poly": [[-4.8, -0.04], [-3.8, -0.04], [-3.8, 0.24], [-4.8, 0.24]], "h": {"const": 2.5}, "surf": "wood"},
    {"poly": [[-4.8, -0.32], [-3.8, -0.32], [-3.8, -0.04], [-4.8, -0.04]], "h": {"const": 2.75}, "surf": "wood"},
    {"poly": [[-4.8, -0.6], [-3.8, -0.6], [-3.8, -0.32], [-4.8, -0.32]], "h": {"const": 3}, "surf": "wood"},
    {"poly": [[-4.8, -0.88], [-3.8, -0.88], [-3.8, -0.6], [-4.8, -0.6]], "h": {"const": 3.25}, "surf": "wood"},
    {"poly": [[-3.7, -3.8], [4.8, -3.8], [4.8, 3.8], [-3.7, 3.8]], "h": {"const": 3.5}, "surf": "wood"},
    {"poly": [[-4.8, -3.8], [-3.7, -3.8], [-3.7, -0.88], [-4.8, -0.88]], "h": {"const": 3.5}, "surf": "wood"},
    {"poly": [[-4.8, 2.2], [-3.7, 2.2], [-3.7, 3.8], [-4.8, 3.8]], "h": {"const": 3.5}, "surf": "wood"},
    {"poly": [[1, 4], [4.6, 4], [4.6, 5.6], [1, 5.6]], "h": {"const": 3.5}, "surf": "wood"}
  ],
  "colliders": [
    {"poly": [[-5, -4], [5, -4], [5, -3.8], [-5, -3.8]], "y0": 0.5, "y1": 6.5},
    {"poly": [[-5, -3.8], [-4.8, -3.8], [-4.8, 3.8], [-5, 3.8]], "y0": 0.5, "y1": 6.5},
    {"poly": [[4.8, -3.8], [5, -3.8], [5, 3.8], [4.8, 3.8]], "y0": 0.5, "y1": 6.5},
    {"poly": [[-5, 3.8], [-0.6, 3.8], [-0.6, 4], [-5, 4]], "y0": 0.5, "y1": 3.5},
    {"poly": [[0.6, 3.8], [5, 3.8], [5, 4], [0.6, 4]], "y0": 0.5, "y1": 3.5},
    {"poly": [[-0.6, 3.8], [0.6, 3.8], [0.6, 4], [-0.6, 4]], "y0": 2.7, "y1": 3.5},
    {"poly": [[-5, 3.8], [2, 3.8], [2, 4], [-5, 4]], "y0": 3.5, "y1": 6.5},
    {"poly": [[3.2, 3.8], [5, 3.8], [5, 4], [3.2, 4]], "y0": 3.5, "y1": 6.5},
    {"poly": [[2, 3.8], [3.2, 3.8], [3.2, 4], [2, 4]], "y0": 5.7, "y1": 6.5},
    {"poly": [[-5.3, -4.3], [5.3, -4.3], [5.3, 4.3], [-5.3, 4.3]], "y0": 6.5, "y1": 6.75},
    {"poly": [[-3.8, -0.88], [-3.7, -0.88], [-3.7, 2.2], [-3.8, 2.2]], "y0": 0.5, "y1": 4.6},
    {"poly": [[-3.7, -3.8], [4.8, -3.8], [4.8, 3.8], [-3.7, 3.8]], "y0": 3.3, "y1": 3.5},
    {"poly": [[-4.8, -3.8], [-3.7, -3.8], [-3.7, -0.88], [-4.8, -0.88]], "y0": 3.3, "y1": 3.5},
    {"poly": [[-4.8, 2.2], [-3.7, 2.2], [-3.7, 3.8], [-4.8, 3.8]], "y0": 3.3, "y1": 3.5},
    {"poly": [[-4.8, 2.2], [-3.8, 2.2], [-3.8, 2.3], [-4.8, 2.3]], "y0": 3.5, "y1": 4.6},
    {"poly": [[1, 4], [4.6, 4], [4.6, 5.6], [1, 5.6]], "y0": 3.3, "y1": 3.5},
    {"poly": [[1, 5.5], [4.6, 5.5], [4.6, 5.6], [1, 5.6]], "y0": 3.5, "y1": 4.6},
    {"poly": [[1, 4], [1.1, 4], [1.1, 5.5], [1, 5.5]], "y0": 3.5, "y1": 4.6},
    {"poly": [[4.5, 4], [4.6, 4], [4.6, 5.5], [4.5, 5.5]], "y0": 3.5, "y1": 4.6},
    {"poly": [[-4, 7], [-2, 7], [-2, 7.5], [-4, 7.5]], "y0": 0.5, "y1": 0.95},
    {"poly": [[2, 7], [4, 7], [4, 8], [2, 8]], "y0": 0.5, "y1": 2.4}
  ],
  "arrive": [0, 0.5, 9, 3.1416]
}
```

## The rules it shows

**Cells are floors, not blocks.** A cell is the top of a floor. A walking player stands on the highest cell at
their `(x, z)` whose top is at most 0.62 m over their feet; the cells higher than that are not there for them.
So cells may lie one over another (the deck under the upper floor, both at the same `(x, z)`): downstairs the
player is on the deck (0.5) and the upper floor (3.5) is out of reach; upstairs on the upper floor. A cell is
never a wall for a walker: walls are colliders.

**A step is a cell** with a constant height, at most 0.62 m over the one before (0.25 here). Make the steps meet
exactly: there is no tolerance, and a gap between two cells is a hole (the player falls through it, perhaps into
the sea). A step's cell may overlap the next one a little; the highest within reach wins.

**A cell has no holes.** Where a floor has a hole (a stairwell), make the floor of pieces round it (cells 12–14).
A ring (round a pond) is pieces too.

**An opening is a gap between colliders.** Cut the wall into a piece left of the door, a piece right of it, and
a lintel over it whose bottom is at least 1.9 m over the floor (the player's band is feet + 0.3 to feet + 1.9).
Make a door at least 1.0 m wide (the player is 0.7 m wide). A storey's wall with openings is its own colliders
(3–5 downstairs, 6–8 upstairs).

**Walls beside a stair go up in one piece.** A collider's top at most 0.62 m over the feet, within 0.5 m of the
player's centre, is ground to stand on. If the left wall were two colliders, 0.5..3.5 and 3.5..6.5, the top of
the lower one (3.5) would hold up a player walking down the stair beside it (on the upper steps their feet are
2.9–3.25): they would walk on at 3.5, in the air over the stair. So a wall without openings is one collider
from the deck to the roof (0–2), and a stair runs beside one of those.

**A low collider is a step.** Its top at most 0.62 m over the floor: the player walks up onto it (the bench, 19).
A thing they must not stand on needs a collider higher than that, whatever its mesh (the planter, 20: the
collider 1.9 m, the mesh 0.8 m). Up to about 1.8 m a jump reaches.

**Floors upstairs are colliders too** (11–13, 15): not needed to stand on (the cells do that), but a collider
stops the follow camera's arm and a cell does not (from above). Without them the camera goes through the
ceiling downstairs. Make them thin (0.2 m) and their bottom over feet + 1.9 of the storey below.

**The rails** (10, 14, 16–18) are 1.1 m over the floor they guard: a wall (more than a step), low enough to see
over.

## Walk it

`check` reads ground.json but does not walk it. Walk it in the UGC browser (AGENTS.md, "See it and play it"),
with `walkTo`, which walks as a player does: never with `teleport` (it puts the player through walls) or
`act()` (it skips the distance check).

The route, and what `player().pos` reads on the way (the UGC browser, 2026-11-23):

| walk to `(x, z)` | | feet `y` | stands on |
|---|---|---|---|
| start | `arrive` | 0.5 | deck |
| (0, 3) | through the door | 0.5 | deck |
| (−4.3, 3), then (−4.3, 2.4) | to the landing, the foot of the stair | 0.5 | deck |
| (−4.3, −1.5) | up the stair | 3.5 | floor B |
| (2.6, −1.5), then (2.6, 3) | across the upper floor | 3.5 | floor A |
| (2.6, 5) | out of the balcony door | 3.5 | the balcony |
| (2.6, 0), (−4.3, −1.5), (−4.3, 2.6) | back, and down the stair | 0.5 | deck |
| (0, 3), (0, 9) | out of the door | 0.5 | deck |
| (−3, 7.25) | onto the bench | 0.95 | the bench's collider |
| (3, 7.5) from (−3, 7.5) | into the planter | 0.5 | stopped at x = 1.65 (2 − 0.35): blocked by collider 20 |

`templates/house/play.json` is this route for `flotopia-ugc play dist play.json` (AGENTS.md); it fails, saying
which collider is in the way, if a door is walled up. The first part as JS for the browser's console:

```js
const U = window.__floating.ugc;
U.play();
for (const [x, z, y] of [[0, 3, 0.5], [-4.3, 3, 0.5], [-4.3, 2.4, 0.5], [-4.3, -1.5, 3.5], [2.6, -1.5, 3.5], [2.6, 3, 3.5], [2.6, 5, 3.5]]) {
  const w = await U.walkTo(x, z);
  if (!w.ok || Math.abs(w.at[1] - y) > 0.05) throw new Error(`to ${x}, ${z}: ${JSON.stringify(w)}`);
}
```
