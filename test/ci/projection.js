/* eslint-env node, mocha */

const assert = require('assert');
const d3geo = require('d3-geo');
const { Jimp } = require('jimp');

const { renderChartJs } = require('../../lib/charts');
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

  it('measures the longitude span in the rotated frame', () => {
    // Fiji's polygons are split at 180 in the vendored data, so d3.geoBounds
    // reports the full 360 degrees for a country a few degrees wide. Measuring
    // from the bbox would classify it as global and hand back equalEarth.
    const { bbox } = describeGeometry(getMap('fji').features);
    assert.strictEqual(bbox[0], -180);
    assert.strictEqual(bbox[2], 180);

    const spec = autoProjectionSpec(getMap('fji').features, 'fji');
    assert.strictEqual(spec.type, 'conicEqualArea');
    assert(Math.abs(spec.rotate[0] + 178.5) < 1, `rotate ${spec.rotate[0]}`);
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

const CANVAS = { width: 400, height: 300 };
const CHUKOTKA = [{ feature: 'Chukchi Autonomous Okrug', value: 8 }];
const SQUARE = {
  type: 'Feature',
  properties: { name: 'Square' },
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [0, 10],
        [10, 10],
        [10, 0],
        [0, 0],
      ],
    ],
  },
};

// Grey borders, i.e. the map as a whole.
const ANY_INK = (r, g, b) => r < 250 || g < 250 || b < 250;
// The blue fill the color scale gives a data row, i.e. one named feature. The
// scale's own legend is blue too, but it lives outside the scanned region.
const DATA_FILL = (r, g, b) => b - r > 40;

/**
 * Renders a chart and measures the bounding box of the pixels `matches`
 * accepts, as a fraction of the canvas. The right quarter is skipped: the
 * color/size scale draws its legend there, which would pin the box to the edge
 * no matter how badly the map itself is framed.
 */
async function measure(chart, matches) {
  const buf = await renderChartJs(CANVAS.width, CANVAS.height, '#ffffff', 1, '4', 'png', chart);
  const { bitmap } = await Jimp.read(buf);
  const scanWidth = Math.floor(bitmap.width * 0.75);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < scanWidth; x += 1) {
      const offset = (y * bitmap.width + x) * 4;
      if (matches(bitmap.data[offset], bitmap.data[offset + 1], bitmap.data[offset + 2])) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (minX === Infinity) {
    return { width: 0, height: 0 };
  }
  return {
    width: (maxX - minX + 1) / scanWidth,
    height: (maxY - minY + 1) / bitmap.height,
  };
}

const inkBox = (chart) => measure(chart, ANY_INK);
const filledBox = (chart) => measure(chart, DATA_FILL);

function choropleth(map, rows, projectionScale) {
  const chart = { type: 'choropleth', data: { datasets: [{ map, data: rows }] } };
  if (projectionScale) {
    chart.options = {
      scales: { projection: { axis: 'x', ...projectionScale }, color: { axis: 'x' } },
    };
  }
  return chart;
}

describe('projection wiring', () => {
  it('frames an antimeridian-crossing map with no configuration at all', async () => {
    const rows = [{ feature: 'Tomsk', value: 10 }];
    const auto = await inkBox(choropleth('rus', rows));
    // The pre-auto default: Russia's bbox wraps past 180, so the fit spans the
    // globe and the country lands in a corner.
    const fixed = await inkBox(choropleth('rus', rows, { projection: 'equalEarth' }));

    assert(auto.width > 0.9, `auto width ${auto.width}`);
    assert(auto.height > 0.5, `auto height ${auto.height}`);
    assert(fixed.height < auto.height / 2, `fixed height ${fixed.height} vs auto ${auto.height}`);
  });

  it('frames a map whose polygons are split at the antimeridian', async () => {
    const rows = [];
    const auto = await inkBox(choropleth('fji', rows));
    const fixed = await inkBox(choropleth('fji', rows, { projection: 'equalEarth' }));
    assert(auto.width > fixed.width * 3, `fiji: ${auto.width} auto vs ${fixed.width}`);
  });

  it('uses the composite projection for the US maps', async () => {
    const box = await inkBox(choropleth('us-states', [{ feature: 'Texas', value: 10 }]));
    // albersUsa insets Alaska and Hawaii instead of stranding them mid-Pacific.
    assert(box.width > 0.9, `width ${box.width}`);
    assert(box.height > 0.5, `height ${box.height}`);
  });

  it('accepts an aimed projection object from a JSON config', async () => {
    const rows = [{ feature: 'Tomsk', value: 10 }];
    const box = await inkBox(
      choropleth('rus', rows, {
        projection: {
          type: 'conicEqualArea',
          rotate: [-100, 0],
          center: [0, 65],
          parallels: [50, 70],
        },
      }),
    );
    assert(box.width > 0.9, `width ${box.width}`);
    assert(box.height > 0.5, `height ${box.height}`);
  });

  it('frames the map on a bounding box and clips the rest', async () => {
    const rows = [{ feature: 'Germany', value: 8 }];
    const projection = {
      type: 'conicEqualArea',
      rotate: [-10, 0],
      center: [0, 53],
      parallels: [43, 63],
    };
    // The whole world is still drawn either way - what `fit` changes is how
    // much of the canvas the region of interest gets. Everything outside is
    // cut by the controller's clipMap.
    const cropped = await filledBox(
      choropleth('world', rows, { projection, fit: { bbox: [-25, 34, 45, 72] } }),
    );
    const whole = await filledBox(choropleth('world', rows, { projection }));

    assert(cropped.width > whole.width * 3, `Germany: ${cropped.width} cropped vs ${whole.width}`);
    assert(
      cropped.height > whole.height * 3,
      `Germany: ${cropped.height} cropped vs ${whole.height}`,
    );
  });

  it('frames the map on a subset of a map’s features', async () => {
    const rows = [{ feature: 'Amur', value: 10 }];
    const cropped = await filledBox(
      choropleth('rus', rows, {
        projection: {
          type: 'conicEqualArea',
          rotate: [-140, 0],
          center: [0, 62],
          parallels: [52, 70],
        },
        fit: { map: 'rus', features: ['Sakha (Yakutia)', 'Khabarovsk', 'Amur', 'Kamchatka'] },
      }),
    );
    const whole = await filledBox(choropleth('rus', rows));
    assert(cropped.width > whole.width * 3, `Amur: ${cropped.width} cropped vs ${whole.width}`);
  });

  it('aims the automatic projection at the fit region, not at the whole map', async () => {
    // A box over Chukotka, which straddles 180. Framing it is not enough - the
    // projection has to be rotated away from the antimeridian too, or its own
    // seam cuts the region in half and the fit spans the map.
    const fit = { bbox: [160, 62, -172, 72] };
    const aimed = await filledBox(choropleth('rus', CHUKOTKA, { fit }));
    const unaimed = await filledBox(choropleth('rus', CHUKOTKA, { fit, projection: 'equalEarth' }));
    assert(aimed.width > 0.8, `aimed width ${aimed.width}`);
    assert(aimed.width > unaimed.width * 5, `${aimed.width} aimed vs ${unaimed.width}`);
  });

  it('accepts a bare bbox array', async () => {
    const rows = [{ feature: 'Brazil', value: 8 }];
    const projection = {
      type: 'conicEqualArea',
      rotate: [-55, 0],
      center: [0, -15],
      parallels: [-30, 0],
    };
    const cropped = await filledBox(
      choropleth('world', rows, { projection, fit: [-75, -35, -33, 6] }),
    );
    const whole = await filledBox(choropleth('world', rows, { projection }));
    assert(cropped.width > whole.width * 3, `Brazil: ${cropped.width} cropped vs ${whole.width}`);
  });

  it('reports bad projection input as a 400 rather than rendering something wrong', async () => {
    const cases = [
      [{ projection: 'winkelTripel' }, 'Unknown projection'],
      [{ projection: { type: 'mercator', rotation: 1 } }, 'rotation'],
      [{ projection: { type: 'albersUsa', rotate: [1, 0] } }, 'does not support'],
      [{ fit: [1, 2, 3] }, 'bbox'],
      [{ fit: { map: 'world', features: ['Atlantis'] } }, 'Unknown feature'],
      [{ fit: 'europe' }, 'Projection "fit"'],
      // A projection of the wrong type entirely: chartjs-chart-geo would fall
      // back to albersUsa and render a plausible-looking wrong map.
      [{ projection: 42 }, 'got number'],
      [{ projection: true }, 'got boolean'],
      [{ projection: null }, 'got null'],
      [{ projection: ['conicEqualArea'] }, 'got array'],
      // Junk in a fit feature list used to render a silently broken chart
      // (numbers) or throw a bare TypeError (null).
      [{ fit: { map: 'world', features: [1, 2, 3] } }, 'inline GeoJSON'],
      [{ fit: { map: 'world', features: [null] } }, 'inline GeoJSON'],
      [{ fit: { map: 'world', features: [['Germany']] } }, 'inline GeoJSON'],
      [{ fit: { features: [1, 2, 3] } }, 'inline GeoJSON'],
      // A name needs a map to be matched against.
      [{ fit: { features: ['Germany'] } }, 'names no map'],
      [{ fit: { map: 'world', features: [] } }, 'no features'],
      // Structurally valid, measures to nothing.
      [{ fit: { type: 'Feature' } }, 'no measurable extent'],
      [{ fit: { type: 'Polygon', coordinates: [] } }, 'no measurable extent'],
    ];
    for (const [scaleOptions, fragment] of cases) {
      // eslint-disable-next-line no-await-in-loop
      await assert.rejects(
        renderChartJs(200, 150, '#fff', 1, '4', 'png', choropleth('world', [], scaleOptions)),
        (err) =>
          err instanceof ChartInputError &&
          err.statusCode === 400 &&
          err.message.includes(fragment),
        `expected a 400 mentioning ${fragment}`,
      );
    }
  });

  it('aims a projection scale that was configured without naming one', async () => {
    // The scale exists but names no projection, so chartjs-chart-geo's
    // albersUsa default would otherwise apply.
    const box = await inkBox(choropleth('rus', [{ feature: 'Tomsk', value: 10 }], { padding: 4 }));
    assert(box.width > 0.9, `width ${box.width}`);
    assert(box.height > 0.5, `height ${box.height}`);
  });

  it('accepts inline GeoJSON in a fit feature list, alongside names', async () => {
    const rows = [{ feature: 'Amur', value: 10 }];
    const cropped = await filledBox(
      choropleth('rus', rows, {
        fit: { map: 'rus', features: ['Amur', { type: 'Point', coordinates: [135, 50] }] },
      }),
    );
    const whole = await filledBox(choropleth('rus', rows));
    assert(cropped.width > whole.width * 3, `${cropped.width} cropped vs ${whole.width}`);
  });

  it('leaves a projection the caller declined to name to the library default', async () => {
    // An inline-outline chart naming no projection is not a QuickChart concern:
    // chartjs-chart-geo's own default applies and must not be second-guessed.
    const chart = {
      type: 'choropleth',
      data: {
        datasets: [
          {
            outline: [SQUARE],
            showOutline: true,
            data: [{ feature: SQUARE, value: 1 }],
          },
        ],
      },
      options: { scales: { projection: { axis: 'x' }, color: { axis: 'x' } } },
    };
    const box = await inkBox(chart);
    assert(box.width > 0, 'expected the chart to render');
  });

  it('leaves a named projection the user chose untouched', async () => {
    const box = await inkBox(
      choropleth('us-states', [{ feature: 'Texas', value: 10 }], { projection: 'albersUsa' }),
    );
    assert(box.width > 0.9, `width ${box.width}`);
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
    assert.strictEqual(describeGeometry({ type: 'Feature' }), null);
    assert.strictEqual(describeGeometry({ type: 'FeatureCollection', features: [] }), null);
  });

  it('reports no extent rather than throwing on malformed geometry', () => {
    // d3.geoBounds throws a TypeError on these; unguarded that becomes a 500.
    assert.strictEqual(describeGeometry({ type: 'Polygon', coordinates: [] }), null);
    assert.strictEqual(describeGeometry({ type: 'LineString', coordinates: [] }), null);
    assert.deepStrictEqual(autoProjectionSpec({ type: 'Polygon', coordinates: [] }, null), {
      type: 'equalEarth',
    });
  });
});
