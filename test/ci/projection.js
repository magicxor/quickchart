/* eslint-env node, mocha */

const assert = require('assert');
const d3geo = require('d3-geo');

const { getMap } = require('../../lib/maps');
const {
  PROJECTION_NAMES,
  autoProjectionSpec,
  bboxOutline,
  buildProjection,
  describeGeometry,
  isProjectionSpec,
  validateProjectionName,
} = require('../../lib/projection');
const { ChartInputError } = require('../../lib/errors');

function assertInputError(fn, ...fragments) {
  assert.throws(
    fn,
    (err) =>
      err instanceof ChartInputError &&
      err.statusCode === 400 &&
      fragments.every((fragment) => err.message.includes(fragment)),
    `expected a ChartInputError mentioning ${fragments.join(', ')}`,
  );
}

describe('projection specs', () => {
  it('builds a projection and applies the aiming setters', () => {
    const projection = buildProjection({
      type: 'conicEqualArea',
      rotate: [-100, 0],
      center: [0, 65],
      parallels: [50, 70],
    });
    assert.deepStrictEqual(projection.rotate(), [-100, 0, 0]);
    assert.deepStrictEqual(projection.center(), [0, 65]);
    assert.deepStrictEqual(projection.parallels(), [50, 70]);
  });

  it('returns a fresh instance every call', () => {
    const spec = { type: 'mercator', rotate: [-10, 0] };
    const first = buildProjection(spec);
    const second = buildProjection(spec);
    assert.notStrictEqual(first, second);
    // The projection scale mutates scale()/translate() while fitting; a shared
    // instance would leak one request's framing into the next.
    first.scale(999);
    assert.notStrictEqual(second.scale(), 999);
  });

  it('accepts both the bare and the geo-prefixed spelling', () => {
    assert.deepStrictEqual(buildProjection({ type: 'geoMercator' }).rotate(), [0, 0, 0]);
    assert.strictEqual(validateProjectionName('geoEqualEarth'), 'geoEqualEarth');
  });

  it('exposes every projection chartjs-chart-geo knows', () => {
    assert.strictEqual(PROJECTION_NAMES.length, 15);
    ['albersUsa', 'conicEqualArea', 'equalEarth', 'mercator'].forEach((name) => {
      assert(PROJECTION_NAMES.includes(name), name);
    });
  });

  it('rejects an unknown projection name and lists the valid ones', () => {
    assertInputError(() => buildProjection({ type: 'winkelTripel' }), 'winkelTripel', 'equalEarth');
    assertInputError(() => validateProjectionName('winkelTripel'), 'winkelTripel');
  });

  it('rejects an unknown projection option', () => {
    assertInputError(() => buildProjection({ type: 'mercator', rotation: [1, 2] }), 'rotation');
  });

  it('points scale/translate at the options that survive the fit', () => {
    assertInputError(() => buildProjection({ type: 'mercator', scale: 200 }), 'projectionScale');
    assertInputError(
      () => buildProjection({ type: 'mercator', translate: [0, 0] }),
      'projectionOffset',
    );
  });

  it('rejects setters the projection does not support', () => {
    // albersUsa is a composite of three projections and cannot be aimed.
    assertInputError(
      () => buildProjection({ type: 'albersUsa', rotate: [-100, 0] }),
      'albersUsa',
      'rotate',
    );
  });

  it('validates setter argument shapes', () => {
    assertInputError(() => buildProjection({ type: 'mercator', rotate: 100 }), 'rotate');
    assertInputError(() => buildProjection({ type: 'mercator', center: [0, 1, 2] }), 'center');
    assertInputError(() => buildProjection({ type: 'mercator', rotate: [0, null] }), 'rotate');
    assertInputError(() => buildProjection({ type: 'mercator', precision: 0 }), 'precision');
    assertInputError(() => buildProjection({ type: 'mercator', reflectX: 'yes' }), 'reflectX');
  });

  it('requires a type', () => {
    assertInputError(() => buildProjection({ rotate: [0, 0] }), 'type');
    assertInputError(() => buildProjection('mercator'), 'type');
  });

  it('recognizes the object form only', () => {
    assert.strictEqual(isProjectionSpec({ type: 'mercator' }), true);
    assert.strictEqual(isProjectionSpec('mercator'), false);
    assert.strictEqual(isProjectionSpec(null), false);
    assert.strictEqual(isProjectionSpec([1, 2]), false);
  });
});

describe('automatic projection', () => {
  it('aims a conic at a country that crosses the antimeridian', () => {
    // Russia's bounding box wraps past 180 (east < west), so its midpoint sits
    // in the Pacific - the rotation has to come from the centroid instead.
    const { bbox } = describeGeometry(getMap('rus').features);
    assert(bbox[2] < bbox[0], `expected an antimeridian-crossing bbox, got ${bbox}`);

    const spec = autoProjectionSpec(getMap('rus').features, 'rus');
    assert.strictEqual(spec.type, 'conicEqualArea');
    assert(spec.rotate[0] > -110 && spec.rotate[0] < -85, `rotate ${spec.rotate[0]}`);
    assert(spec.parallels[0] < spec.parallels[1]);
  });

  it('aims a conic at an ordinary country', () => {
    const spec = autoProjectionSpec(getMap('deu').features, 'deu');
    assert.strictEqual(spec.type, 'conicEqualArea');
    assert(Math.abs(spec.rotate[0] + 10.36) < 1, `rotate ${spec.rotate[0]}`);
    assert(Math.abs(spec.center[1] - 51.2) < 1, `center ${spec.center[1]}`);
  });

  it('uses the override table for the composite and global maps', () => {
    assert.deepStrictEqual(autoProjectionSpec(getMap('us-states').features, 'us-states'), {
      type: 'albersUsa',
    });
    assert.deepStrictEqual(autoProjectionSpec(getMap('usa').features, 'USA'), {
      type: 'albersUsa',
    });
    assert.deepStrictEqual(autoProjectionSpec(getMap('world').features, 'world'), {
      type: 'equalEarth',
    });
  });

  it('falls back to a whole-globe projection for global or unmeasurable outlines', () => {
    assert.deepStrictEqual(autoProjectionSpec({ type: 'Sphere' }, null), { type: 'equalEarth' });
    assert.deepStrictEqual(autoProjectionSpec(null, null), { type: 'equalEarth' });
    assert.deepStrictEqual(autoProjectionSpec([], null), { type: 'equalEarth' });
    // An unnamed world outline still has to be recognized by its extent.
    assert.deepStrictEqual(autoProjectionSpec(getMap('world').features, null), {
      type: 'equalEarth',
    });
  });

  it('produces a spec that buildProjection accepts', () => {
    ['rus', 'deu', 'bra', 'aus', 'chl', 'idn', 'world', 'us-states'].forEach((name) => {
      const spec = autoProjectionSpec(getMap(name).features, name);
      assert.strictEqual(typeof buildProjection(spec).stream, 'function', name);
    });
  });
});

describe('projection fit geometry', () => {
  it('traces a bounding box as a densified LineString', () => {
    const outline = bboxOutline([-25, 34, 45, 72]);
    assert.strictEqual(outline.type, 'LineString');
    assert(outline.coordinates.length > 100);
    assert.deepStrictEqual(outline.coordinates[0], [-25, 34]);
    // The trace closes back on its starting corner.
    assert.deepStrictEqual(outline.coordinates[outline.coordinates.length - 1], [-25, 34]);
  });

  it('fits to the box itself, not to the rest of the sphere', () => {
    // Regression guard for the polygon-winding trap: a Polygon wound the wrong
    // way is the sphere minus the box, which fits to the whole globe. Under
    // equirectangular the fitted aspect ratio is exactly the box aspect ratio.
    const outline = bboxOutline([0, 0, 10, 10]);
    const projection = d3geo.geoEquirectangular().fitWidth(1000, outline);
    const [[x0, y0], [x1, y1]] = d3geo.geoPath(projection).bounds(outline);
    assert(Math.abs(x1 - x0 - 1000) < 1, `width ${x1 - x0}`);
    assert(Math.abs(y1 - y0 - 1000) < 1, `height ${y1 - y0} (500 means it fitted the globe)`);
  });

  it('handles a box that crosses the antimeridian', () => {
    const outline = bboxOutline([170, 60, -170, 72]);
    const lons = outline.coordinates.map(([lon]) => lon);
    assert(lons.every((lon) => lon >= -180 && lon <= 180));

    // Such a box only fits sanely once the projection is rotated away from the
    // antimeridian - unrotated, the projection itself cuts the box in two at
    // 180 and the fit spans the whole map. This is what `auto` rotates for.
    const projection = d3geo.geoEquirectangular().rotate([-180, 0]);
    const [[x0, y0], [x1, y1]] = d3geo.geoPath(projection.fitWidth(1000, outline)).bounds(outline);
    // 20 degrees of longitude by 12 of latitude.
    assert(Math.abs((x1 - x0) / (y1 - y0) - 20 / 12) < 0.05, `aspect ${(x1 - x0) / (y1 - y0)}`);
  });

  it('rejects malformed boxes', () => {
    assertInputError(() => bboxOutline([1, 2, 3]), 'bbox');
    assertInputError(() => bboxOutline([0, 34, 10, 34]), 'south < north');
    assertInputError(() => bboxOutline([0, -95, 10, 10]), 'south < north');
    assertInputError(() => bboxOutline([0, 0, 0, 10]), 'positive longitude range');
    assertInputError(() => bboxOutline(['a', 0, 10, 10]), 'bbox');
  });
});

describe('geometry measurement', () => {
  it('reports bbox and centroid', () => {
    const measured = describeGeometry(getMap('deu').features);
    assert(Math.abs(measured.centroid[0] - 10.36) < 0.1);
    assert(Math.abs(measured.centroid[1] - 51.05) < 0.1);
    assert.strictEqual(measured.bbox.length, 4);
    assert(measured.bbox[0] < measured.bbox[2]);
  });

  it('returns null for nothing measurable', () => {
    assert.strictEqual(describeGeometry(null), null);
    assert.strictEqual(describeGeometry([]), null);
    assert.strictEqual(describeGeometry({ nope: true }), null);
  });
});
