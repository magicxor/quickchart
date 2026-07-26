/* eslint-env node, mocha */

const assert = require('assert');

const getColors = require('get-image-colors');
const { imageSize } = require('image-size');
const request = require('supertest');

const app = require('../../index');
const { BASIC_CHART, JS_CHART } = require('./chart_helpers');
const { assertSimilarRgb } = require('./color_helpers');
const { getQrValue } = require('./qr_helpers');

function assertDimensions(res, width, height) {
  const dimensions = imageSize(res.body);
  assert.equal(width, dimensions.width);
  assert.equal(height, dimensions.height);
}

async function assertDominantColor(res, rgb) {
  const actual = (await getColors(res.body, 'image/png'))[0].rgb();
  assertSimilarRgb(rgb, actual);
}

describe('chart request', () => {
  it('returns a basic chart via GET', async () => {
    const res = await request(app)
      .get(`/chart?c=${encodeURIComponent(JSON.stringify(BASIC_CHART))}`)
      .expect('Content-Type', 'image/png')
      .expect(200);
    assertDimensions(res, 500 * 2, 300 * 2);
  });

  it('returns a basic chart via GET, base64 encoded', async () => {
    const res = await request(app)
      .get(
        `/chart?c=${Buffer.from(JSON.stringify(BASIC_CHART)).toString('base64')}&encoding=base64`,
      )
      .expect('Content-Type', 'image/png')
      .expect(200);
    assertDimensions(res, 500 * 2, 300 * 2);
  });

  it('returns an JS chart via GET', async () => {
    const res = await request(app)
      .get(`/chart?c=${encodeURIComponent(JS_CHART)}`)
      .expect('Content-Type', 'image/png')
      .expect(200);
    assertDimensions(res, 500 * 2, 300 * 2);
  });

  it('returns a basic chart via GET with parameters', async () => {
    const res = await request(app)
      .get(
        `/chart?c=${encodeURIComponent(
          JSON.stringify(BASIC_CHART),
        )}&width=200&height=100&devicePixelRatio=1&backgroundColor=rgb(249, 193, 202)`,
      )
      .expect('Content-Type', 'image/png')
      .expect(200);
    await assertDominantColor(res, [249, 193, 202]);
    assertDimensions(res, 200, 100);
  });

  it('returns a basic chart via POST', async () => {
    const res = await request(app)
      .post('/chart')
      .send({
        chart: BASIC_CHART,
      })
      .expect('Content-Type', 'image/png')
      .expect(200);
    assertDimensions(res, 500 * 2, 300 * 2);
  });

  it('returns a basic chart via POST, base64 encoded', async () => {
    const res = await request(app)
      .post('/chart')
      .send({
        chart: Buffer.from(JSON.stringify(BASIC_CHART)).toString('base64'),
        encoding: 'base64',
      })
      .expect('Content-Type', 'image/png')
      .expect(200);
    assertDimensions(res, 500 * 2, 300 * 2);
  });

  it('returns an advanced chart via POST', async () => {
    const res = await request(app)
      .post('/chart')
      .send({
        chart: JS_CHART,
      })
      .expect('Content-Type', 'image/png')
      .expect(200);
    assertDimensions(res, 500 * 2, 300 * 2);
  });

  it('returns an advanced chart via POST with parameters', async () => {
    const res = await request(app)
      .post('/chart')
      .send({
        chart: JS_CHART,
        width: 456,
        height: 123,
        devicePixelRatio: 1.0,
        backgroundColor: 'rgb(90, 80, 70)',
      })
      .expect('Content-Type', 'image/png')
      .expect(200);
    await assertDominantColor(res, [90, 80, 70]);
    assertDimensions(res, 456, 123);
  });

  it('returns an advanced chart via POST with parameters and base 64', async () => {
    const res = await request(app)
      .post('/chart')
      .send({
        chart: Buffer.from(JS_CHART).toString('base64'),
        width: 369,
        height: 150,
        devicePixelRatio: 1.0,
        backgroundColor: 'rgb(190, 180, 170)',
        encoding: 'base64',
      })
      .expect('Content-Type', 'image/png')
      .expect(200);
    await assertDominantColor(res, [190, 180, 170]);
    assertDimensions(res, 369, 150);
  });

  it('reverts correctly to background transparency', async () => {
    // Don't let background selection stick between requests.
    const res = await request(app)
      .post('/chart')
      .send({
        chart: BASIC_CHART,
      })
      .expect('Content-Type', 'image/png')
      .expect(200);
    // Image is transparent by default - expect dominant color to be the
    // chart.js 4 Colors plugin default blue.
    await assertDominantColor(res, [52, 164, 236]);
    assertDimensions(res, 500 * 2, 300 * 2);
  });
});

describe('api error handling and headers', () => {
  it('returns a deprecation header when version is specified', async () => {
    const res = await request(app)
      .post('/chart')
      .send({
        chart: BASIC_CHART,
        version: '2.9.4',
      })
      .expect('Content-Type', 'image/png')
      .expect(200);
    assert(res.headers['x-quickchart-deprecation'].includes('deprecated'));
  });

  it('returns no deprecation header without a version', async () => {
    const res = await request(app)
      .post('/chart')
      .send({
        chart: BASIC_CHART,
      })
      .expect(200);
    assert.strictEqual(res.headers['x-quickchart-deprecation'], undefined);
  });

  it('returns 400 when the chart is missing', async () => {
    const res = await request(app)
      .post('/chart')
      .send({})
      .expect('Content-Type', 'image/png')
      .expect(400);
    assert(res.headers['x-quickchart-error'].includes('missing variable'));
  });

  it('returns 400 with a populated error header for an invalid config', async () => {
    const res = await request(app)
      .post('/chart')
      .send({
        chart: 'this is not a chart config {{{',
      })
      .expect('Content-Type', 'image/png')
      .expect(400);
    assert(res.headers['x-quickchart-error'].includes('Invalid input'));
  });

  it('returns 400 for an unknown chart type', async () => {
    const res = await request(app)
      .post('/chart')
      .send({
        chart: { type: 'radialGauge', data: { datasets: [{ data: [50] }] } },
      })
      .expect(400);
    assert(res.headers['x-quickchart-error'].length > 0);
  });

  it('no longer serves POST /telemetry', async () => {
    await request(app).post('/telemetry').send({ chartCount: 1, pid: 'abc' }).expect(404);
  });
});

describe('qr endpoint', () => {
  it('renders basic qr', async () => {
    const qrText = 'hello werld';
    const res = await request(app)
      .get(`/qr?text=${encodeURIComponent(qrText)}`)
      .expect('Content-Type', 'image/png')
      .expect(200);
    assertDimensions(res, 150, 150);

    const result = await getQrValue(res.body);
    assert.equal(qrText, result);
  });
});
