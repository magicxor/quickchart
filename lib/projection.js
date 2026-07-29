/**
 * Declarative d3-geo projection support for geo charts (choropleth/bubbleMap).
 *
 * chartjs-chart-geo's projection scale accepts either the name of a d3
 * projection or a ready-made d3 projection object, but only the name survives
 * a JSON chart config - and a bare name cannot be aimed anywhere, so any map
 * that is not centred on the prime meridian renders off-frame. This module
 * builds projection objects server-side from a plain-JSON spec, derives a
 * sensible one automatically, and frames the view on an arbitrary region.
 *
 * Pure geometry: it knows nothing about the map registry (see lib/maps.js),
 * which keeps the dependency one-way.
 */
const d3geo = require('d3-geo');

const { ChartInputError } = require('./errors');
const { poleOfInaccessibility } = require('./polylabel');

// Same set (and spelling) as chartjs-chart-geo's own lookup table, so a name
// that works here works there and vice versa.
const PROJECTIONS = {
  azimuthalEqualArea: d3geo.geoAzimuthalEqualArea,
  azimuthalEquidistant: d3geo.geoAzimuthalEquidistant,
  gnomonic: d3geo.geoGnomonic,
  orthographic: d3geo.geoOrthographic,
  stereographic: d3geo.geoStereographic,
  equalEarth: d3geo.geoEqualEarth,
  albers: d3geo.geoAlbers,
  albersUsa: d3geo.geoAlbersUsa,
  conicConformal: d3geo.geoConicConformal,
  conicEqualArea: d3geo.geoConicEqualArea,
  conicEquidistant: d3geo.geoConicEquidistant,
  equirectangular: d3geo.geoEquirectangular,
  mercator: d3geo.geoMercator,
  transverseMercator: d3geo.geoTransverseMercator,
  naturalEarth1: d3geo.geoNaturalEarth1,
};

const PROJECTION_NAMES = Object.keys(PROJECTIONS).sort();

// Maps whose geometry defeats the automatic heuristic below. The US ones span
// the antimeridian via the Aleutians and are ~40% empty Pacific in any single
// projection; albersUsa is the composite d3 provides for exactly that case.
const AUTO_OVERRIDES = {
  us: 'albersUsa',
  'us-states': 'albersUsa',
  'us-counties': 'albersUsa',
  usa: 'albersUsa',
  world: 'equalEarth',
  'world-50m': 'equalEarth',
  'world-land': 'equalEarth',
};

// Beyond these spans a conic projection is the wrong tool and the whole-globe
// default reads better.
const GLOBAL_LON_SPAN = 200;
const GLOBAL_LAT_SPAN = 120;

// Degrees between sampled points along a bounding-box edge. Box edges are
// great-circle arcs once projected, so they need sampling to bound correctly.
const BBOX_STEP = 2;

// Side of the square that `measureAspectRatio` fits a geometry into. Only the
// ratio of the result is used, so the value just needs to be big enough that
// rounding in the projection does not show.
const MEASURE_EXTENT = 1000;

function lookupFactory(name) {
  // chartjs-chart-geo registers both `mercator` and `geoMercator`; accept both.
  const key = /^geo[A-Z]/.test(name) ? `${name.charAt(3).toLowerCase()}${name.slice(4)}` : name;
  return PROJECTIONS[key] || null;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function numberTuple(value, min, max, label) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw new ChartInputError(
      `Projection "${label}" must be an array of ${min === max ? min : `${min}-${max}`} numbers`,
    );
  }
  if (!value.every(isFiniteNumber)) {
    throw new ChartInputError(`Projection "${label}" must contain only finite numbers`);
  }
  return value;
}

// Chainable d3 projection setters that are meaningful before the scale fits
// the projection to the chart area. `scale`/`translate` are deliberately
// absent: the fit overwrites both (use projectionScale/projectionOffset).
const SETTERS = {
  rotate: (value) => numberTuple(value, 2, 3, 'rotate'),
  center: (value) => numberTuple(value, 2, 2, 'center'),
  parallels: (value) => numberTuple(value, 2, 2, 'parallels'),
  clipAngle: (value) => {
    if (!isFiniteNumber(value)) {
      throw new ChartInputError('Projection "clipAngle" must be a number');
    }
    return value;
  },
  clipExtent: (value) => {
    if (value === null) {
      return value;
    }
    if (!Array.isArray(value) || value.length !== 2) {
      throw new ChartInputError('Projection "clipExtent" must be [[x0, y0], [x1, y1]] or null');
    }
    value.forEach((corner) => numberTuple(corner, 2, 2, 'clipExtent'));
    return value;
  },
  precision: (value) => {
    if (!isFiniteNumber(value) || value <= 0) {
      throw new ChartInputError('Projection "precision" must be a number greater than 0');
    }
    return value;
  },
  angle: (value) => {
    if (!isFiniteNumber(value)) {
      throw new ChartInputError('Projection "angle" must be a number');
    }
    return value;
  },
  reflectX: (value) => {
    if (typeof value !== 'boolean') {
      throw new ChartInputError('Projection "reflectX" must be a boolean');
    }
    return value;
  },
  reflectY: (value) => {
    if (typeof value !== 'boolean') {
      throw new ChartInputError('Projection "reflectY" must be a boolean');
    }
    return value;
  },
};

const SETTER_NAMES = Object.keys(SETTERS).sort();

/**
 * True for the object form of a projection option, i.e. `{ type, rotate, ... }`
 * as opposed to a name string or an already-built d3 projection function.
 */
function isProjectionSpec(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validates a projection name, returning it unchanged. Throws a 400 for
 * unknown names, which chartjs-chart-geo would otherwise swallow by silently
 * falling back to albersUsa.
 */
function validateProjectionName(name) {
  if (!lookupFactory(name)) {
    throw new ChartInputError(
      `Unknown projection "${name}". Available projections: ${PROJECTION_NAMES.join(', ')}.`,
    );
  }
  return name;
}

/**
 * Builds a d3 projection from a plain-JSON spec such as
 * `{ type: 'conicEqualArea', rotate: [-100, 0], parallels: [50, 70] }`.
 *
 * Always returns a fresh object: the projection scale mutates it in place
 * (scale/translate) while fitting, so instances must not be shared between
 * requests.
 */
function buildProjection(spec) {
  if (!isProjectionSpec(spec)) {
    throw new ChartInputError('Projection must be a name or an object with a "type"');
  }
  const { type } = spec;
  if (typeof type !== 'string') {
    throw new ChartInputError(
      `Projection object needs a "type" naming a projection. Available projections: ${PROJECTION_NAMES.join(', ')}.`,
    );
  }
  const factory = lookupFactory(type);
  if (!factory) {
    validateProjectionName(type);
  }
  const projection = factory();

  Object.keys(spec).forEach((key) => {
    if (key === 'type') {
      return;
    }
    const validate = SETTERS[key];
    if (!validate) {
      if (key === 'scale' || key === 'translate') {
        throw new ChartInputError(
          `Projection "${key}" is overwritten when the map is fitted to the chart area. Use the scale's projectionScale/projectionOffset options instead.`,
        );
      }
      throw new ChartInputError(
        `Unknown projection option "${key}". Supported: type, ${SETTER_NAMES.join(', ')}.`,
      );
    }
    if (typeof projection[key] !== 'function') {
      // e.g. albersUsa is a composite and supports none of the aiming setters.
      throw new ChartInputError(`Projection "${type}" does not support "${key}"`);
    }
    projection[key](validate(spec[key]));
  });

  return projection;
}

/**
 * Wraps loose GeoJSON input - a Feature[], a FeatureCollection, a geometry, or
 * null - into something d3-geo can measure. Returns null when there is nothing
 * to measure.
 */
function toGeoJson(value) {
  if (!value) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? { type: 'FeatureCollection', features: value } : null;
  }
  return typeof value === 'object' && value.type ? value : null;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

// d3-geo throws a TypeError on structurally malformed geometry - an empty
// coordinate array, say - rather than reporting no extent. For our purposes the
// two answers are the same, and caller-supplied geometry must not reach the
// HTTP layer as a 500.
function tryMeasure(measurer, geo) {
  try {
    return measurer(geo);
  } catch {
    return null;
  }
}

/**
 * Measures a GeoJSON value: `{ bbox: [w, s, e, n], centroid: [lon, lat] }`, or
 * null if it has no finite extent. Note that `bbox[2] < bbox[0]` when the
 * geometry crosses the antimeridian - d3 reports the *smallest* enclosing
 * longitude range, not a left-to-right one.
 */
function describeGeometry(value) {
  const geo = toGeoJson(value);
  if (!geo) {
    return null;
  }
  const bounds = tryMeasure(d3geo.geoBounds, geo);
  if (!bounds) {
    return null;
  }
  const [[west, south], [east, north]] = bounds;
  if (![west, south, east, north].every(isFiniteNumber)) {
    return null;
  }
  const centroid = tryMeasure(d3geo.geoCentroid, geo);
  return {
    bbox: [round(west), round(south), round(east), round(north)],
    centroid:
      centroid && centroid.every(isFiniteNumber) ? [round(centroid[0]), round(centroid[1])] : null,
  };
}

/**
 * Proportions of a geometry as it will be drawn: the width of its projected
 * bounding box over the height, or null if it cannot be measured. A throwaway
 * projection is fitted to a square, so the result describes the shape and the
 * projection rather than any particular canvas - `rus` comes out at 1.78
 * whatever it is drawn on.
 */
function measureAspectRatio(geometry, spec) {
  const geo = toGeoJson(geometry);
  if (!geo) {
    return null;
  }
  let projection;
  try {
    projection = buildProjection(spec);
  } catch {
    return null;
  }
  // A separate instance: fitting mutates the projection, and the chart's own
  // copy must stay as the caller configured it.
  const bounds = tryMeasure((value) => {
    projection.fitExtent(
      [
        [0, 0],
        [MEASURE_EXTENT, MEASURE_EXTENT],
      ],
      value,
    );
    return d3geo.geoPath(projection).bounds(value);
  }, geo);
  if (!bounds) {
    return null;
  }
  const [[x0, y0], [x1, y1]] = bounds;
  if (![x0, y0, x1, y1].every(isFiniteNumber)) {
    return null;
  }
  const width = x1 - x0;
  const height = y1 - y0;
  return width > 0 && height > 0 ? width / height : null;
}

/**
 * Derives a projection spec that frames `outline` sensibly, given the built-in
 * map name it came from (used only to consult the override table).
 *
 * The recipe is the standard d3 one: rotate the globe so the region's centroid
 * meridian faces the viewer, then use a conic equal-area projection with
 * standard parallels at 1/6 and 5/6 of the latitude range. Rotating by
 * longitude alone leaves latitudes untouched, so the parallels can be read
 * straight off the unrotated bounds.
 *
 * The centroid - not the bounding-box midpoint - sets the rotation: a region
 * crossing the antimeridian (Russia, Fiji, New Zealand) has a bounding box
 * whose midpoint lands on the far side of the planet.
 */
function autoProjectionSpec(outline, mapName) {
  const override = mapName ? AUTO_OVERRIDES[String(mapName).toLowerCase()] : null;
  if (override) {
    return { type: override };
  }

  const geo = toGeoJson(outline);
  if (!geo) {
    return { type: 'equalEarth' };
  }
  const centroid = tryMeasure(d3geo.geoCentroid, geo);
  if (!centroid || !isFiniteNumber(centroid[0])) {
    return { type: 'equalEarth' };
  }
  const lon0 = centroid[0];

  // Wrapped like the d3 calls above: this walk is defensive, but a structure
  // pathological enough to blow the stack must still not become a 500.
  const measured = tryMeasure((value) => measureRotated(value, lon0), geo);
  if (!measured) {
    return { type: 'equalEarth' };
  }
  const { lonSpan, south, north } = measured;
  const latSpan = north - south;
  if (lonSpan > GLOBAL_LON_SPAN || latSpan > GLOBAL_LAT_SPAN) {
    return { type: 'equalEarth' };
  }

  return {
    type: 'conicEqualArea',
    rotate: [round(-lon0), 0],
    center: [0, round((south + north) / 2)],
    parallels: [round(south + latSpan / 6), round(north - latSpan / 6)],
  };
}

function normalizeLon(lon) {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

function forEachPosition(node, visit) {
  if (!node || typeof node !== 'object') {
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((child) => forEachPosition(child, visit));
    return;
  }
  switch (node.type) {
    case 'FeatureCollection':
      forEachPosition(node.features, visit);
      return;
    case 'Feature':
      forEachPosition(node.geometry, visit);
      return;
    case 'GeometryCollection':
      forEachPosition(node.geometries, visit);
      return;
    default:
      break;
  }
  if (node.coordinates) {
    visitCoordinates(node.coordinates, visit);
  }
}

function visitCoordinates(coordinates, visit) {
  // Malformed GeoJSON can put anything under `coordinates`; a non-array simply
  // holds no vertices. d3 tolerates some of these (it ignores `coordinates` on a
  // Sphere, for instance), so this walk must not be the stricter of the two.
  if (!Array.isArray(coordinates)) {
    return;
  }
  if (typeof coordinates[0] === 'number') {
    visit(coordinates[0], coordinates[1]);
    return;
  }
  coordinates.forEach((child) => visitCoordinates(child, visit));
}

/**
 * Measures a geometry's extent in the frame rotated to `lon0`, returning
 * `{ lonSpan, south, north }` or null if it has no vertices.
 *
 * The rotated frame is what makes this reliable near the antimeridian.
 * d3.geoBounds reports a longitude range in the unrotated frame, and for a
 * country whose polygons are split at 180 - Fiji, Kiribati, Tuvalu in the
 * vendored data - that range is the full 360 degrees even though the country
 * is a few degrees wide. Rotating first collapses it to the real span.
 * Latitudes are unaffected by a longitude-only rotation.
 */
function measureRotated(geo, lon0) {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let south = Infinity;
  let north = -Infinity;

  forEachPosition(geo, (lon, lat) => {
    if (!isFiniteNumber(lon) || !isFiniteNumber(lat)) {
      return;
    }
    const rotated = normalizeLon(lon - lon0);
    minLon = Math.min(minLon, rotated);
    maxLon = Math.max(maxLon, rotated);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  });

  if (minLon === Infinity) {
    return null;
  }
  return { lonSpan: maxLon - minLon, south, north };
}

// How far a detached piece of a geometry may sit from the body it is framed
// with and still count as part of it, in degrees. Wide enough to hold a strait,
// a channel or an island chain together, narrow enough to separate an overseas
// department from its mainland.
const MAINLAND_GAP_DEG = 10;

// GeoJSON types that are a bag of parts, and what one part of each is.
const MULTI_PART_MEMBERS = {
  MultiPolygon: 'Polygon',
  MultiLineString: 'LineString',
  MultiPoint: 'Point',
};

// The separately-framable pieces of a GeoJSON value: every polygon of a
// MultiPolygon, every line of a MultiLineString, every feature of a collection.
// A part is the unit the mainland heuristic keeps or drops.
function collectParts(node, parts) {
  if (!node || typeof node !== 'object') {
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((child) => collectParts(child, parts));
    return;
  }
  switch (node.type) {
    case 'FeatureCollection':
      collectParts(node.features, parts);
      return;
    case 'Feature':
      collectParts(node.geometry, parts);
      return;
    case 'GeometryCollection':
      collectParts(node.geometries, parts);
      return;
    default:
      break;
  }
  const memberType = MULTI_PART_MEMBERS[node.type];
  if (memberType && Array.isArray(node.coordinates)) {
    node.coordinates.forEach((coordinates) => parts.push({ type: memberType, coordinates }));
    return;
  }
  if (node.coordinates) {
    // A type with no coordinates at all (Sphere) has no extent to cluster by.
    parts.push(node);
  }
}

function mod360(degrees) {
  return ((degrees % 360) + 360) % 360;
}

// Degrees between two longitude ranges the short way round, 0 when they
// overlap. Ranges wrap: `[170, -170]` is the 20 degrees across the antimeridian,
// not the 340 the other way, so neither range can be compared as an interval of
// numbers.
function lonGap(a, b) {
  const aSpan = a[2] >= a[0] ? a[2] - a[0] : a[2] + 360 - a[0];
  const bSpan = b[2] >= b[0] ? b[2] - b[0] : b[2] + 360 - b[0];
  // Where b sits measured eastward from a's western edge.
  const start = mod360(b[0] - a[0]);
  const end = start + bSpan;
  if (start <= aSpan || end >= 360) {
    return 0;
  }
  return Math.min(start - aSpan, 360 - end);
}

function boxGap(a, b) {
  const latGap = Math.max(0, Math.max(a[1] - b[3], b[1] - a[3]));
  return Math.hypot(lonGap(a, b), latGap);
}

/**
 * True when two `[west, south, east, north]` boxes overlap. Either may wrap the
 * antimeridian, i.e. have an east smaller than its west.
 */
function boxesIntersect(a, b) {
  return boxGap(a, b) === 0;
}

// Groups parts that are within `MAINLAND_GAP_DEG` of each other, transitively:
// an island chain hangs together even when its ends are far apart. Grouping by
// pairwise gaps rather than by a growing group box keeps the result independent
// of the order the parts arrive in, and keeps the antimeridian case (`lonGap`)
// confined to one comparison at a time.
function clusterParts(measured) {
  const parent = measured.map((item, index) => index);
  const find = (index) => {
    let root = index;
    while (parent[root] !== root) {
      parent[root] = parent[parent[root]];
      root = parent[root];
    }
    return root;
  };

  for (let i = 0; i < measured.length; i += 1) {
    for (let j = i + 1; j < measured.length; j += 1) {
      const a = find(i);
      const b = find(j);
      if (a !== b && boxGap(measured[i].box, measured[j].box) <= MAINLAND_GAP_DEG) {
        parent[b] = a;
      }
    }
  }

  const groups = new Map();
  measured.forEach((item, index) => {
    const root = find(index);
    const group = groups.get(root);
    if (group) {
      group.push(item);
    } else {
      groups.set(root, [item]);
    }
  });
  return [...groups.values()];
}

function totalArea(group) {
  return group.reduce((sum, item) => sum + item.area, 0);
}

/**
 * Drops the pieces of a geometry that are detached from its main body, so a fit
 * can frame a country's mainland rather than its whole territory: France's
 * feature reaches South America through French Guiana, and framing all of it
 * leaves Europe a corner of the canvas.
 *
 * Keeps the group of neighbouring parts with the largest total area and drops
 * the rest. Returns the value unchanged when it has nothing to choose between -
 * a single part, one group, unmeasurable geometry, or no area at all (a bbox
 * outline is a LineString, and lines have none).
 */
function mainlandGeometry(value) {
  const parts = [];
  collectParts(value, parts);
  if (parts.length < 2) {
    return value;
  }

  const measured = [];
  for (const part of parts) {
    const bounds = tryMeasure(d3geo.geoBounds, part);
    if (!bounds || !bounds.flat().every(isFiniteNumber)) {
      return value;
    }
    measured.push({
      part,
      area: tryMeasure(d3geo.geoArea, part) || 0,
      box: [bounds[0][0], bounds[0][1], bounds[1][0], bounds[1][1]],
    });
  }

  const groups = clusterParts(measured);
  if (groups.length < 2) {
    return value;
  }
  const main = groups.reduce((best, group) => (totalArea(group) > totalArea(best) ? group : best));
  if (totalArea(main) <= 0) {
    return value;
  }
  return { type: 'GeometryCollection', geometries: main.map((item) => item.part) };
}

/**
 * A d3 path that measures geometry the way the chart shows it: projected, then
 * cut to the pixel rectangle the map is drawn in.
 *
 * geoPath measures through anything with a `stream`, which is what lets the
 * rectangle sit *after* the projection. That matters twice: a clip in lon/lat
 * cannot describe a canvas edge, and geoAlbersUsa - the automatic choice for the
 * US maps - is a composite with no clipExtent of its own to set.
 */
function clippedPath(projection, extent) {
  return d3geo.geoPath(clippedStream(projection, extent));
}

// The projection with the rectangle behind it, as something `geoPath` and
// `geoStream` both accept.
function clippedStream(projection, extent) {
  const rect = d3geo.geoIdentity().clipExtent(extent);
  return { stream: (sink) => projection.stream(rect.stream(sink)) };
}

/**
 * The outline the chart paints for one part, as pixel-space rings: projected,
 * cut to the view, in whatever order and winding the cut produced.
 *
 * Same stream the measurements above go through, ending in a sink that records
 * the coordinates instead of measuring them.
 */
function clippedRings(projection, extent, part) {
  const rings = [];
  let ring = null;
  const sink = {
    polygonStart() {},
    polygonEnd() {},
    lineStart() {
      ring = [];
    },
    lineEnd() {
      if (ring && ring.length > 0) {
        rings.push(ring);
      }
      ring = null;
    },
    point(x, y) {
      if (ring) {
        ring.push([x, y]);
      }
    },
    sphere() {},
  };
  const { stream } = clippedStream(projection, extent);
  tryMeasure((value) => d3geo.geoStream(value, stream(sink)), part);
  return rings;
}

/**
 * Builds the label-anchor measurer for one view: `anchor(feature)` returns the
 * `[x, y]` a label for that region belongs on, or null when the view shows
 * nothing of it worth measuring - in which case the caller keeps the anchor it
 * already had.
 *
 * The anchor is the centre of the largest *part* of the region that is *in
 * view*, and both halves of that carry their own weight:
 *
 * - In view, because a region reaching past the frame has its centre somewhere
 *   off-screen: Russia on a map cropped to Europe is centred in Siberia, 121px
 *   above a 700px canvas, so its label is drawn outside the image and simply
 *   never appears.
 * - Largest part, because a centre of area averages over every scrap of
 *   territory, and for a country whose parts are oceans apart that average is
 *   water: France's world-atlas feature reaches South America through French
 *   Guiana, which drags its label 130px off the country into the Atlantic
 *   west of Biscay.
 *
 * Parts, not the neighbour clusters `mainlandGeometry` frames on: a label needs
 * one piece of land to sit on, and the grouping that holds an archipelago
 * together for framing puts its centre in the sea between the islands.
 *
 * A centre of area can miss even a single part, which no amount of choosing
 * between parts can fix: a crescent's is in whatever it curls around, and a
 * region that rings an enclave has its own in the enclave. Where the centre
 * lands off the region, the anchor is the point with the most room around it
 * instead (see lib/polylabel.js) - the same shape, asked a different question.
 *
 * `extent` is `[[x0, y0], [x1, y1]]` in the projection's own pixel space.
 */
function visibleAnchorFor(projection, extent) {
  const path = clippedPath(projection, extent);
  // A caller's own projection need not be invertible, and there is no telling
  // whether a point is on a region without going back to lon/lat.
  const invertible = typeof projection.invert === 'function';

  // Would a label at this point be written on the region? The point comes from
  // measuring the clipped shape, so it is inside the view already (a polygon's
  // centre of area lies within its own bounding box, and the view is a box), and
  // in-view plus on-the-feature is on painted ink. Anything unmeasurable answers
  // yes: moving a label on a guess is worse than leaving it where it is.
  const onRegion = (point, part) => {
    if (!invertible) {
      return true;
    }
    // Called on the projection rather than through a reference held to it: d3's
    // own `invert` is a closure and would not notice, but a caller can pass any
    // object with a `stream`, and one whose `invert` reads `this` would answer
    // wrongly or throw - which reads here as "the centre is fine", quietly
    // leaving the labels this exists to move.
    const lonLat = tryMeasure((value) => projection.invert(value), point);
    if (!lonLat || !lonLat.every(isFiniteNumber)) {
      return true;
    }
    return tryMeasure((value) => d3geo.geoContains(part, value), lonLat) !== false;
  };

  return (feature) => {
    const parts = [];
    collectParts(feature, parts);
    let best = null;
    parts.forEach((part) => {
      // Absolute: a ring wound the other way measures negative, and which way a
      // part happens to be wound says nothing about how much of it is on screen.
      const area = Math.abs(tryMeasure((value) => path.area(value), part) || 0);
      if (area > 0 && (best === null || area > best.area)) {
        best = { area, part };
      }
    });
    if (best === null) {
      // The region is out of frame entirely, or every part of it is too small to
      // cover a pixel of it (a county the size of Falls Church). A centroid of
      // that is noise, and the anchor already in place is no worse.
      return null;
    }
    const centre = tryMeasure((value) => path.centroid(value), best.part);
    if (!centre || !centre.every(isFiniteNumber)) {
      return null;
    }
    if (onRegion(centre, best.part)) {
      return centre;
    }
    // Only now is the shape itself worth reading out: the rings cost a pass of
    // their own, and this is the handful of regions per map that need one.
    const room = poleOfInaccessibility(clippedRings(projection, extent, best.part));
    return room ? room.point : centre;
  };
}

/**
 * Plugin that anchors each region's label on the part of it the view shows (see
 * `visibleAnchorFor`) rather than on the centre of its whole territory, which is
 * what chartjs-chart-geo's GeoFeature measures.
 *
 * `afterDatasetUpdate` is the hook that has everything this needs: the layout
 * has run, so the chart area is known; the projection scale has been fitted to
 * it; and the controller has already written the anchors being replaced.
 */
function createLabelAnchorPlugin() {
  return {
    id: 'quickchart-geo-label-anchor',
    afterDatasetUpdate(chart, args) {
      const scale = chart.scales.projection;
      const elements = args.meta ? args.meta.data : null;
      if (!scale || !scale.projection || typeof scale.projection.stream !== 'function') {
        // A caller can hand the scale any function as its projection; only a
        // real d3 projection can be streamed through a clip.
        return;
      }
      if (!Array.isArray(elements) || elements.length === 0) {
        return;
      }
      let anchorFor = null;
      elements.forEach((element) => {
        // No shape to measure (a bubbleMap draws points), or the caller named
        // the anchor themselves with a data row's `center`, which wins.
        if (!element.feature || element.center) {
          return;
        }
        // Built on the first region rather than up front, so a dataset that has
        // none pays nothing.
        anchorFor =
          anchorFor || visibleAnchorFor(scale.projection, visibleExtent(chart, args.meta));
        const anchor = anchorFor(element.feature);
        if (!anchor) {
          return;
        }
        const [x, y] = anchor;
        element.x = x;
        element.y = y;
        // GeoFeature.getCenterPoint() answers from this cache, and the
        // controller re-reads it on any later update pass; leaving it stale
        // would put the two coordinates out of step.
        element.cache = { ...(element.cache || {}), center: { x, y } };
      });
    },
  };
}

/**
 * The pixel rectangle a region can appear in: the chart area, which is what the
 * geo controller clips regions to (`clipMap`, on by default), or the whole
 * canvas when that clipping is off and the map may spill past it.
 */
function visibleExtent(chart, meta) {
  const controller = meta ? meta.controller : null;
  const clipMap =
    controller && typeof controller.clipMap === 'function' ? controller.clipMap() : true;
  if (clipMap !== true && clipMap !== 'items') {
    // 'outline'/'graticule'/false all leave the regions themselves unclipped.
    return [
      [0, 0],
      [chart.width, chart.height],
    ];
  }
  const { left, top, right, bottom } = chart.chartArea;
  return [
    [left, top],
    [right, bottom],
  ];
}

/**
 * Turns `[west, south, east, north]` into a densified LineString tracing the
 * box, for use as a projection fit target.
 *
 * A LineString rather than a Polygon on purpose: d3-geo reads a polygon's ring
 * winding to decide which side is the interior, and a box wound the "wrong"
 * way silently becomes the whole sphere minus the box - which fits to the
 * globe instead of the region. A LineString has no interior and no winding.
 */
function bboxOutline(bbox) {
  // Not numberTuple's own message: the caller wrote `fit`, and may not have
  // written the word "bbox" at all (a bare 4-number array is accepted too).
  if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(isFiniteNumber)) {
    throw new ChartInputError(
      'Projection "fit" bbox must be 4 numbers: [west, south, east, north]',
    );
  }
  const [west, south, east, north] = bbox;
  if (south < -90 || north > 90 || south >= north) {
    throw new ChartInputError(
      'Projection "fit" bbox must be [west, south, east, north] with -90 <= south < north <= 90',
    );
  }
  const lonSpan = east >= west ? east - west : east + 360 - west;
  if (lonSpan <= 0 || lonSpan > 360) {
    throw new ChartInputError('Projection "fit" bbox must span a positive longitude range');
  }

  const latSpan = north - south;
  const lonSteps = Math.max(1, Math.ceil(lonSpan / BBOX_STEP));
  const latSteps = Math.max(1, Math.ceil(latSpan / BBOX_STEP));
  const coordinates = [];
  const push = (lon, lat) => coordinates.push([normalizeLon(lon), lat]);

  for (let i = 0; i <= lonSteps; i += 1) {
    push(west + (lonSpan * i) / lonSteps, south);
  }
  for (let i = 1; i <= latSteps; i += 1) {
    push(west + lonSpan, south + (latSpan * i) / latSteps);
  }
  for (let i = 1; i <= lonSteps; i += 1) {
    push(west + lonSpan - (lonSpan * i) / lonSteps, north);
  }
  for (let i = 1; i <= latSteps; i += 1) {
    push(west, north - (latSpan * i) / latSteps);
  }

  return { type: 'LineString', coordinates };
}

/**
 * Plugin that frames the projection on `geometry` instead of on the dataset
 * outline, so a chart can draw one thing and be framed on another. Whatever
 * falls outside the chart area is cut by the controller's own `clipMap`.
 *
 * `beforeDatasetUpdate` (singular) is the only hook positioned between
 * GeoController.linkScales(), which fits the projection to the dataset
 * outline, and the controller update that reads the fitted bounds - an earlier
 * hook is simply overwritten by linkScales.
 */
function createFitPlugin(geometry) {
  return {
    id: 'quickchart-geo-fit',
    beforeDatasetUpdate(chart) {
      const scale = chart.scales.projection;
      if (scale && typeof scale.computeBounds === 'function') {
        scale.computeBounds(geometry);
      }
    },
  };
}

module.exports = {
  PROJECTION_NAMES,
  PROJECTION_OPTION_NAMES: SETTER_NAMES,
  autoProjectionSpec,
  bboxOutline,
  boxesIntersect,
  buildProjection,
  createFitPlugin,
  createLabelAnchorPlugin,
  describeGeometry,
  isProjectionSpec,
  mainlandGeometry,
  measureAspectRatio,
  toGeoJson,
  validateProjectionName,
  visibleAnchorFor,
};
