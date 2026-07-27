/* eslint-env node, mocha */

const assert = require('assert');

const { renderChartJs } = require('../../lib/charts');
const {
  featureAlias,
  getFeatureExtents,
  getMap,
  getMapGeography,
  resolveOutline,
  matchFeature,
  listMaps,
  describeMap,
} = require('../../lib/maps');
const { ChartInputError } = require('../../lib/errors');

describe('map registry', () => {
  it('lists the atlas maps and vendored countries', () => {
    const names = new Set(listMaps().map((m) => m.name));
    ['world', 'world-50m', 'world-land', 'us', 'us-states', 'us-counties'].forEach((name) => {
      assert(names.has(name), `expected atlas map ${name}`);
    });
    ['deu', 'fra', 'jpn', 'usa'].forEach((name) => {
      assert(names.has(name), `expected datamaps country ${name}`);
    });
    // All ~254 vendored countries plus the 6 atlas maps.
    assert(names.size > 250, `expected 250+ maps, got ${names.size}`);
  });

  it('lists a source for every map', () => {
    for (const entry of listMaps()) {
      assert(['world-atlas', 'us-atlas', 'datamaps'].includes(entry.source), entry.source);
    }
  });

  it('loads maps lazily and caches them', () => {
    const first = getMap('world');
    assert(Array.isArray(first.features) && first.features.length > 100);
    assert.strictEqual(first.topology.type, 'Topology');
    // Same instance on repeat access, including case-insensitive names.
    assert.strictEqual(getMap('world'), first);
    assert.strictEqual(getMap('WORLD'), first);
  });

  it('resolves single-outline maps to one feature', () => {
    assert.strictEqual(resolveOutline('world-land').length, 1);
    assert.strictEqual(resolveOutline('us').length, 1);
  });

  it('throws a 400 ChartInputError for an unknown map', () => {
    assert.throws(
      () => getMap('atlantis'),
      (err) =>
        err instanceof ChartInputError &&
        err.statusCode === 400 &&
        err.message.includes('atlantis'),
    );
  });

  it('matches features by name, case-insensitively', () => {
    assert.strictEqual(matchFeature('world', 'Germany').properties.name, 'Germany');
    assert.strictEqual(matchFeature('world', 'gErMaNy').properties.name, 'Germany');
    assert.strictEqual(matchFeature('us-states', 'california').properties.name, 'California');
  });

  it('matches features by id', () => {
    // world-atlas ids are ISO 3166-1 numeric ("276" = Germany).
    assert.strictEqual(matchFeature('world', '276').properties.name, 'Germany');
    // us-atlas ids are FIPS codes ("06" = California).
    assert.strictEqual(matchFeature('us-states', '06').properties.name, 'California');
    // datamaps subunit ids ("DE.BE" = Berlin).
    assert.strictEqual(matchFeature('deu', 'de.be').properties.name, 'Berlin');
  });

  it('throws a 400 ChartInputError for an unknown feature', () => {
    assert.throws(
      () => matchFeature('world', 'Atlantis'),
      (err) =>
        err instanceof ChartInputError &&
        err.statusCode === 400 &&
        err.message.includes('Atlantis') &&
        err.message.includes('world'),
    );
  });

  it('describes a map with its matchable features', () => {
    const description = describeMap('deu');
    assert.strictEqual(description.name, 'deu');
    assert.strictEqual(description.source, 'datamaps');
    const berlin = description.features.find((f) => f.name === 'Berlin');
    assert(berlin, 'expected a Berlin feature');
    assert.strictEqual(berlin.id, 'DE.BE');
  });

  it('describes where a map is and how to aim at it', () => {
    const russia = describeMap('rus');
    // east < west: the map wraps past the antimeridian.
    assert(russia.bbox[2] < russia.bbox[0], `bbox ${russia.bbox}`);
    assert(Math.abs(russia.centroid[0] - 95.8) < 1, `centroid ${russia.centroid}`);
    assert.strictEqual(russia.projection.type, 'conicEqualArea');
    // The reported spec is exactly what a caller can paste into a config.
    assert(Array.isArray(russia.projection.rotate));

    assert.deepStrictEqual(describeMap('world').projection, { type: 'equalEarth' });
    assert.deepStrictEqual(describeMap('us-states').projection, { type: 'albersUsa' });
  });

  it('caches a map’s geography', () => {
    assert.strictEqual(getMapGeography('deu'), getMapGeography('DEU'));
  });

  it('measures and caches every feature of a map', () => {
    const extents = getFeatureExtents('blr');
    assert.strictEqual(extents.length, resolveOutline('blr').length);
    const minsk = extents.find(({ feature }) => featureAlias(feature) === 'City of Minsk');
    assert(minsk, 'expected a City of Minsk feature');
    assert.deepStrictEqual(
      minsk.bbox.map(Math.round),
      [27, 54, 28, 54],
      `Minsk bbox ${minsk.bbox}`,
    );
    assert.strictEqual(getFeatureExtents('blr'), getFeatureExtents('BLR'));
  });

  it('names a feature the way a data row would reference it', () => {
    assert.strictEqual(featureAlias(matchFeature('world', 'Germany')), 'Germany');
    // Some datamaps subdivisions have no name and are matchable by id only.
    assert.strictEqual(featureAlias({ properties: {}, id: 'DE.BE' }), 'DE.BE');
    assert.strictEqual(featureAlias({ properties: {} }), null);
  });
});

describe('geo coverage', () => {
  const partial = () => ({
    type: 'choropleth',
    data: {
      datasets: [
        {
          map: 'blr',
          data: [
            { feature: 'Minsk', value: 1 },
            { feature: 'Brest', value: 2 },
          ],
        },
      ],
    },
  });

  async function coverageOf(chart) {
    const diagnostics = {};
    await renderChartJs(200, 150, '#fff', 1, '4', 'png', chart, diagnostics);
    return diagnostics.geoCoverage;
  }

  it('reports the framed features that have no data row', async () => {
    const coverage = await coverageOf(partial());
    assert.deepStrictEqual(coverage.maps.length, 1);
    const [entry] = coverage.maps;
    assert.strictEqual(entry.map, 'blr');
    assert.strictEqual(entry.framed, resolveOutline('blr').length);
    assert.strictEqual(entry.covered, 2);
    assert(entry.missing.includes('Gomel'), `missing: ${entry.missing}`);
    assert(!entry.missing.includes('Minsk'), `missing: ${entry.missing}`);
    assert.strictEqual(entry.more, undefined);
  });

  it('says nothing when every framed feature has data', async () => {
    const chart = partial();
    chart.data.datasets[0].data = resolveOutline('blr').map((feature) => ({
      feature: featureAlias(feature),
      value: 1,
    }));
    assert.strictEqual(await coverageOf(chart), undefined);
  });

  it('pools datasets that name the same map with different casing', async () => {
    const chart = {
      type: 'choropleth',
      data: {
        datasets: [
          { map: 'BLR', data: [{ feature: 'Minsk', value: 1 }] },
          { map: 'blr', data: [{ feature: 'Brest', value: 2 }] },
        ],
      },
    };
    const { maps } = await coverageOf(chart);
    // One map is drawn, so one entry: keyed per spelling, each dataset would
    // report the other's regions as missing.
    const entry = maps.length === 1 ? maps[0] : null;
    assert(entry, `expected one entry, got ${JSON.stringify(maps)}`);
    assert.strictEqual(entry.map, 'blr');
    assert.strictEqual(entry.covered, 2);
  });

  it('pools the datasets of one map, as a categorical map builds it', async () => {
    const rows = resolveOutline('blr').map((feature) => featureAlias(feature));
    const chart = {
      type: 'choropleth',
      data: {
        datasets: rows.map((name) => ({ map: 'blr', data: [{ feature: name }] })),
      },
    };
    assert.strictEqual(await coverageOf(chart), undefined);
  });

  it('counts only the features a fit leaves in frame', async () => {
    const farEast = () => ({
      type: 'choropleth',
      data: { datasets: [{ map: 'rus', data: [{ feature: 'Amur', value: 1 }] }] },
    });
    const whole = await coverageOf(farEast());
    assert.strictEqual(whole.maps[0].framed, resolveOutline('rus').length);

    const chart = farEast();
    chart.options = {
      scales: {
        projection: { axis: 'x', fit: { map: 'rus', features: ['Amur', 'Khabarovsk'] } },
      },
    };
    const [entry] = (await coverageOf(chart)).maps;
    // Cropping to the Far East is not an omission of the rest of Russia.
    assert(entry.framed < 15, `framed ${entry.framed} of ${resolveOutline('rus').length}`);
    assert(entry.missing.includes('Khabarovsk'), `missing: ${entry.missing}`);
  });

  it('caps the named features and counts the rest', async () => {
    const coverage = await coverageOf({
      type: 'choropleth',
      data: { datasets: [{ map: 'world', data: [{ feature: 'Germany', value: 1 }] }] },
    });
    const [entry] = coverage.maps;
    assert.strictEqual(entry.covered, 1);
    assert.strictEqual(entry.missing.length, 20);
    assert(entry.more > 100, `more: ${entry.more}`);
  });

  it('reports nothing for a chart with no map', async () => {
    assert.strictEqual(
      await coverageOf({ type: 'bar', data: { labels: ['a'], datasets: [{ data: [1] }] } }),
      undefined,
    );
  });
});
