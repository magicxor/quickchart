/* eslint-env node, mocha */

const assert = require('assert');

const { poleOfInaccessibility, signedDistance } = require('../../lib/polylabel');

function ring(...points) {
  return [...points, points[0]];
}

function square(x, y, size) {
  return ring([x, y], [x + size, y], [x + size, y + size], [x, y + size]);
}

// The centre of area of a single ring, i.e. what the label anchor uses until it
// misses the shape.
function centreOfArea(points) {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const cross = points[j][0] * points[i][1] - points[i][0] * points[j][1];
    area += cross;
    cx += (points[j][0] + points[i][0]) * cross;
    cy += (points[j][1] + points[i][1]) * cross;
  }
  return [cx / (3 * area), cy / (3 * area)];
}

// Independent answer to the same question, by looking everywhere: what the
// search has to match, since a bug in it would otherwise just be a slightly
// worse point.
function bestOnGrid(rings, step) {
  let best = { point: null, distance: -Infinity };
  const xs = rings.flat().map((point) => point[0]);
  const ys = rings.flat().map((point) => point[1]);
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += step) {
    for (let y = Math.min(...ys); y <= Math.max(...ys); y += step) {
      const distance = signedDistance(x, y, rings);
      if (distance > best.distance) {
        best = { point: [x, y], distance };
      }
    }
  }
  return best;
}

// A C, i.e. a crescent: the right side is cut out, and the centre of area sits
// in the gap rather than on the shape - Croatia and Vietnam in miniature.
const CRESCENT = [
  ring([0, 0], [100, 0], [100, 30], [30, 30], [30, 70], [100, 70], [100, 100], [0, 100]),
];

// A square with a square hole: a county that surrounds an independent city.
const DONUT = [square(0, 0, 100), square(30, 30, 40).slice().reverse()];

describe('pole of inaccessibility', () => {
  it('puts a symmetric shape in the middle', () => {
    const found = poleOfInaccessibility([square(0, 0, 100)]);
    assert(Math.abs(found.point[0] - 50) < 1, `x ${found.point[0]}`);
    assert(Math.abs(found.point[1] - 50) < 1, `y ${found.point[1]}`);
    assert(Math.abs(found.distance - 50) < 1, `distance ${found.distance}`);
  });

  it('finds room in a crescent whose centre of area is off it', () => {
    const centre = centreOfArea(CRESCENT[0]);
    assert(
      signedDistance(centre[0], centre[1], CRESCENT) < 0,
      'the centre of area was on the shape',
    );

    const found = poleOfInaccessibility(CRESCENT);
    assert(found.distance > 0, `distance ${found.distance}`);
    assert(
      signedDistance(found.point[0], found.point[1], CRESCENT) > 0,
      `pole ${JSON.stringify(found.point)} is not inside`,
    );
  });

  it('stays out of a hole, and does not care which ring came first', () => {
    const centre = centreOfArea(DONUT[0]);
    // Dead centre of the outer ring, i.e. the middle of the hole.
    assert(signedDistance(centre[0], centre[1], DONUT) < 0, 'the hole counted as inside');

    const found = poleOfInaccessibility(DONUT);
    assert(signedDistance(found.point[0], found.point[1], DONUT) > 0, 'pole landed in the hole');
    // A clipped shape's rings arrive in whatever order the cut produced, so the
    // hole can be the first of them - and its own bounding box holds no room at
    // all.
    const reversed = poleOfInaccessibility([DONUT[1], DONUT[0]]);
    assert.deepStrictEqual(reversed.point, found.point);
  });

  it('measures the room it found', () => {
    // A bar 8 wide has room 4 whatever its length.
    const bar = [ring([0, 0], [200, 0], [200, 8], [0, 8])];
    const found = poleOfInaccessibility(bar);
    assert(Math.abs(found.distance - 4) < 0.5, `distance ${found.distance}`);
  });

  it('prefers the larger of two disjoint pieces', () => {
    const found = poleOfInaccessibility([square(0, 0, 20), square(100, 0, 60)]);
    assert(found.point[0] > 100, `pole ${JSON.stringify(found.point)} is not in the larger piece`);
    assert(Math.abs(found.distance - 30) < 1, `distance ${found.distance}`);
  });

  it('reports nothing for a shape with no interior', () => {
    // Every one of these has a boundary of sorts and no room between its sides,
    // and a point picked anyway would be a label off the map.
    [
      null,
      undefined,
      'nonsense',
      [],
      [[]],
      [
        [
          [0, 0],
          [10, 10],
        ],
      ],
      [ring([0, 0], [10, 0], [20, 0])],
      [square(5, 5, 0)],
      [ring([NaN, 0], [10, NaN], [5, 5])],
    ].forEach((rings) => {
      assert.strictEqual(
        poleOfInaccessibility(rings),
        null,
        `expected null for ${JSON.stringify(rings)}`,
      );
    });
  });

  it('matches an exhaustive search over awkward shapes', () => {
    // Star polygons with random radii: reliably concave, and reliably centred on
    // nothing in particular.
    let seed = 20260729;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const corners = 5 + Math.floor(random() * 10);
      const points = [];
      for (let i = 0; i < corners; i += 1) {
        const angle = (i / corners) * Math.PI * 2;
        const radius = 5 + random() * 95;
        points.push([100 + radius * Math.cos(angle), 100 + radius * Math.sin(angle)]);
      }
      const rings = [ring(...points)];
      const found = poleOfInaccessibility(rings);
      const grid = bestOnGrid(rings, 2);
      assert(found, `no pole for shape ${attempt}`);
      assert(
        signedDistance(found.point[0], found.point[1], rings) > 0,
        `shape ${attempt}: pole ${JSON.stringify(found.point)} is outside it`,
      );
      // The grid is coarse, so it may be beaten; it must not win by much.
      assert(
        grid.distance - found.distance < 1.5,
        `shape ${attempt}: grid found ${grid.distance.toFixed(2)} vs ${found.distance.toFixed(2)}`,
      );
    }
  });
});
