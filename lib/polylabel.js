/**
 * Pole of inaccessibility: the point inside a polygon that is furthest from any
 * of its edges.
 *
 * Where a label goes when the centre of area is not on the shape at all. A
 * crescent has its centre of area in whatever it curls around - Croatia's is in
 * Bosnia, Vietnam's is in Laos - and a region that rings an enclave has its own
 * in the enclave, which is how the US counties that surround an independent city
 * end up labelled over the city. The centre of area answers "where is the
 * middle"; this answers "where is there room", which is what a label needs.
 *
 * Plain planar geometry over pixel coordinates: the caller projects and clips
 * first (see lib/projection.js), so nothing here knows about the globe.
 *
 * The search is Mapbox's polylabel. Cover the polygon in square cells, then
 * repeatedly quarter the most promising one, where a cell's promise is the
 * distance from its centre to the polygon plus the distance from its centre to
 * its own corner - an upper bound on anything the cell could contain. A cell
 * whose bound cannot beat the best point found so far is dropped whole, and that
 * pruning is what keeps the search cheap. Written out here rather than taken from
 * the package: the package is ESM-only with a priority-queue dependency of its
 * own, against the ~100 lines of arithmetic below, which this server needs in
 * pixel space rather than in the lon/lat the package documents.
 */

// Cells that could beat the best point found so far by less than this are not
// split any further. A label is text on a canvas: half a pixel of extra room is
// not a distinction anything can see.
const PRECISION = 0.5;

// A ring needs three points to enclose anything; fewer is a line, and a line has
// no interior to find a point in.
const MIN_RING_POINTS = 3;

// Ceiling on the cells one search may examine. The pruning above makes real
// geometry converge in a few hundred, but the polygon can be inline GeoJSON from
// a request, and a shape crafted to defeat the pruning must not be able to spend
// the process's time on it. Cutting the search short only costs precision: the
// answer returned is still the best point found, and still inside the polygon.
const MAX_CELLS = 20000;

/**
 * Squared distance from a point to the segment ab.
 *
 * Squared throughout: what reads it only compares distances, comparison is
 * monotonic in the square, and a square root per segment per cell would be the
 * whole cost of the search.
 */
function segmentDistSq(x, y, a, b) {
  let nearX = a[0];
  let nearY = a[1];
  const dx = b[0] - nearX;
  const dy = b[1] - nearY;
  if (dx !== 0 || dy !== 0) {
    // Where the perpendicular from the point meets the line, as a fraction of
    // the segment; outside 0..1 the nearer end of the segment is the answer.
    const along = ((x - nearX) * dx + (y - nearY) * dy) / (dx * dx + dy * dy);
    if (along > 1) {
      nearX = b[0];
      nearY = b[1];
    } else if (along > 0) {
      nearX += dx * along;
      nearY += dy * along;
    }
  }
  return (x - nearX) ** 2 + (y - nearY) ** 2;
}

/**
 * Distance from a point to the polygon's boundary, signed: positive inside the
 * polygon, negative outside it.
 *
 * One walk of every ring answers both halves - the nearest edge, and the
 * even-odd crossing count that says which side of the boundary the point is on.
 * Holes need no special case in either: a ring inside another flips the parity
 * back to outside, whichever way round the two are wound, which is what lets a
 * caller hand over a clipped shape's rings in whatever order they arrived in.
 */
function signedDistance(x, y, rings) {
  let inside = false;
  let nearestSq = Infinity;
  rings.forEach((ring) => {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const a = ring[i];
      const b = ring[j];
      if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) {
        inside = !inside;
      }
      nearestSq = Math.min(nearestSq, segmentDistSq(x, y, a, b));
    }
  });
  if (nearestSq === Infinity) {
    return -Infinity;
  }
  return (inside ? 1 : -1) * Math.sqrt(nearestSq);
}

// One square of the search: its centre, its half-width, how far its centre is
// from the polygon, and the best any point inside it could manage - the corner
// is half a diagonal away, and no point can be further from the boundary than
// that.
function makeCell(x, y, half, rings) {
  const distance = signedDistance(x, y, rings);
  return { x, y, half, distance, bound: distance + half * Math.SQRT2 };
}

/**
 * Binary max-heap of cells, ordered by the bound above.
 *
 * The search always wants the most promising cell next and pushes four more for
 * every one it takes, so the order has to be maintained rather than recomputed:
 * re-sorting an array per push is what the heap replaces.
 */
function createQueue() {
  const cells = [];
  const swap = (i, j) => {
    const held = cells[i];
    cells[i] = cells[j];
    cells[j] = held;
  };
  return {
    get size() {
      return cells.length;
    },
    push(cell) {
      cells.push(cell);
      let index = cells.length - 1;
      while (index > 0) {
        const parent = (index - 1) >> 1;
        if (cells[parent].bound >= cells[index].bound) {
          return;
        }
        swap(parent, index);
        index = parent;
      }
    },
    pop() {
      const top = cells[0];
      const last = cells.pop();
      if (cells.length > 0) {
        cells[0] = last;
        let index = 0;
        for (;;) {
          const left = index * 2 + 1;
          let largest = index;
          if (left < cells.length && cells[left].bound > cells[largest].bound) {
            largest = left;
          }
          if (left + 1 < cells.length && cells[left + 1].bound > cells[largest].bound) {
            largest = left + 1;
          }
          if (largest === index) {
            return top;
          }
          swap(largest, index);
          index = largest;
        }
      }
      return top;
    },
  };
}

function ringsOf(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((ring) => Array.isArray(ring) && ring.length >= MIN_RING_POINTS);
}

function boundsOf(rings) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  rings.forEach((ring) => {
    ring.forEach((point) => {
      const [x, y] = Array.isArray(point) ? point : [NaN, NaN];
      if (Number.isFinite(x) && Number.isFinite(y)) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    });
  });
  return { minX, minY, maxX, maxY };
}

/**
 * Finds the interior point of `rings` furthest from its boundary, as
 * `{ point: [x, y], distance }`, or null when the shape has no interior to
 * speak of - no usable ring, a degenerate sliver, coordinates that are not
 * numbers.
 *
 * `rings` is `[[[x, y], ...], ...]`: an outer ring and its holes, or several of
 * each, in any order and wound either way (see `signedDistance`).
 */
function poleOfInaccessibility(rings, precision = PRECISION) {
  const usable = ringsOf(rings);
  if (usable.length === 0) {
    return null;
  }
  // Measured over every ring rather than the first: a clipped shape comes back
  // as however many rings the cut left, in no particular order, so the first of
  // them can perfectly well be a hole - whose own box would send the search
  // looking for room in the one place the shape has none.
  const { minX, minY, maxX, maxY } = boundsOf(usable);
  const width = maxX - minX;
  const height = maxY - minY;
  const cellSize = Math.min(width, height);
  if (!Number.isFinite(cellSize) || cellSize <= 0) {
    return null;
  }

  const queue = createQueue();
  const half = cellSize / 2;
  for (let x = minX; x < maxX; x += cellSize) {
    for (let y = minY; y < maxY; y += cellSize) {
      queue.push(makeCell(x + half, y + half, half, usable));
    }
  }
  // The centre of the bounding box is inside most shapes, and starting the
  // pruning from a real distance rather than from nothing is what stops the
  // first rounds spending cells on the outside of the polygon.
  let best = makeCell(minX + width / 2, minY + height / 2, 0, usable);
  let examined = queue.size;

  while (queue.size > 0 && examined < MAX_CELLS) {
    const cell = queue.pop();
    if (cell.distance > best.distance) {
      best = cell;
    }
    if (cell.bound - best.distance <= precision) {
      continue;
    }
    const quarter = cell.half / 2;
    queue.push(makeCell(cell.x - quarter, cell.y - quarter, quarter, usable));
    queue.push(makeCell(cell.x + quarter, cell.y - quarter, quarter, usable));
    queue.push(makeCell(cell.x - quarter, cell.y + quarter, quarter, usable));
    queue.push(makeCell(cell.x + quarter, cell.y + quarter, quarter, usable));
    examined += 4;
  }

  // Everything the search looked at was outside the polygon, which a shape thin
  // enough can manage: it has a boundary but no room between its sides.
  return best.distance > 0 ? { point: [best.x, best.y], distance: best.distance } : null;
}

module.exports = {
  poleOfInaccessibility,
  signedDistance,
};
