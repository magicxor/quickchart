QuickChart
---

[QuickChart](https://quickchart.io/) is a service that generates images of charts from a URL.  Because these charts are simple images, they are very easy to embed in non-dynamic environments such as email, SMS, chat rooms, and so on.

> **Note:** This fork is modernized to run on a single, current [Chart.js 4](https://www.chartjs.org/) with the full suite of [sgratzl chart.js plugins](https://github.com/sgratzl). It intentionally drops legacy Chart.js 2/3 rendering, the Google Image Charts compatibility endpoints, and Graphviz. See [Differences from upstream](#differences-from-upstream).

## See it in action

The chart image generation service is available online at [QuickChart.io](https://quickchart.io/).  There is an interactive editor that allows you to adjust inputs and build images.

A chart is defined completely by its URL or by the JSON body of a `POST /chart` request:

```js
{
  type: 'bar',
  data: {
    labels: ['January', 'February', 'March', 'April', 'May'],
    datasets: [{
      label: 'Dogs',
      data: [ 50, 60, 70, 180, 190 ]
    }, {
      label: 'Cats',
      data: [ 100, 200, 300, 400, 500 ]
    }]
  }
}
```

**Go to the full [QuickChart documentation](https://quickchart.io/documentation) to learn more.  See [gallery](https://quickchart.io/gallery/) for examples.**

## API

`GET /chart` and `POST /chart` accept the following parameters (query parameters for GET, JSON or form body fields for POST):

| Parameter | Alias | Description |
|---|---|---|
| `chart` | `c` | Chart.js 4 config, as JSON or a Javascript object literal (required) |
| `width` | `w` | Image width in logical pixels (default 500) |
| `height` | `h` | Image height in logical pixels (default 300) |
| `backgroundColor` | `bkg` | Canvas background color (default transparent) |
| `devicePixelRatio` | | Pixel density multiplier, output is `width*ratio` x `height*ratio` (default 2, must be > 0 and <= 4) |
| `format` | `f` | `png` (default), `svg`, or `pdf` |
| `encoding` | | `url` (default) or `base64` for the `chart` parameter |
| `version` | `v` | **Deprecated.** Accepted for backwards compatibility but ignored; charts always render with the bundled Chart.js 4.  Requests using it receive an `X-quickchart-deprecation` response header |

Invalid requests (missing or malformed chart config, out-of-range sizes, unknown chart types, unsupported formats) return HTTP **400**; unexpected server failures return HTTP **500**.  In both cases the error message is rendered as an image (so broken embeds show the reason) and echoed in the `X-quickchart-error` response header.

Other endpoints: `GET /maps` lists the built-in geo maps (see [Geo charts and built-in maps](#geo-charts-and-built-in-maps)), `GET /qr` renders QR codes, and `GET /healthcheck` reports service health.

## Configuring your chart

The chart configuration object is based on the popular Chart.js API.  Check out the [Chart.js documentation](https://www.chartjs.org/docs/latest/) for more information on how to customize your chart, or see [QuickChart documentation](https://quickchart.io/documentation#parameters) for API options.

**Configs must use Chart.js 4 syntax** (`options.scales.x`/`options.scales.y`, `options.plugins.legend`, `options.plugins.title`, and so on). Chart.js 2-style configs (`scales.xAxes`, top-level `legend`, `type: 'horizontalBar'`) are not translated.

### Included chart plugins

The following plugins are registered and ready to use:

| Package | Chart types / features |
|---|---|
| [chartjs-plugin-annotation](https://github.com/chartjs/chartjs-plugin-annotation) | Line, box, ellipse, point, and label annotations via `options.plugins.annotation` |
| [chartjs-plugin-datalabels](https://github.com/chartjs/chartjs-plugin-datalabels) | Data labels via `options.plugins.datalabels` (shown by default for pie/doughnut) |
| [@sgratzl/chartjs-chart-boxplot](https://github.com/sgratzl/chartjs-chart-boxplot) | `boxplot`, `violin` |
| [chartjs-chart-error-bars](https://github.com/sgratzl/chartjs-chart-error-bars) | `barWithErrorBars`, `lineWithErrorBars`, `scatterWithErrorBars`, `polarAreaWithErrorBars` |
| [chartjs-chart-funnel](https://github.com/sgratzl/chartjs-chart-funnel) | `funnel` |
| [chartjs-chart-geo](https://github.com/sgratzl/chartjs-chart-geo) | `choropleth`, `bubbleMap` — see [Geo charts and built-in maps](#geo-charts-and-built-in-maps) |
| [chartjs-chart-graph](https://github.com/sgratzl/chartjs-chart-graph) | `graph`, `forceDirectedGraph`, `dendrogram`, `tree` |
| [chartjs-chart-pcp](https://github.com/sgratzl/chartjs-chart-pcp) | `pcp`, `logarithmicPcp` (parallel coordinates) |
| [chartjs-chart-venn](https://github.com/sgratzl/chartjs-chart-venn) | `venn`, `euler` |
| [chartjs-chart-wordcloud](https://github.com/sgratzl/chartjs-chart-wordcloud) | `wordCloud` |
| [chartjs-plugin-hierarchical](https://github.com/sgratzl/chartjs-plugin-hierarchical) | `hierarchical` scale type for expandable category axes |
| [chartjs-adapter-moment](https://github.com/chartjs/chartjs-adapter-moment) | `time` scales with moment.js format strings |

QuickChart custom types also work: `sparkline`, `progressBar`, and the `donut` alias.  `horizontalBoxplot`/`horizontalViolin` map to their vertical counterparts with `indexAxis: 'y'`.  Default dataset colors come from the built-in Chart.js [Colors plugin](https://www.chartjs.org/docs/latest/general/colors.html).

Note on server-side rendering: charts render exactly once (no animation loop), so `forceDirectedGraph` layouts run a fixed number of simulation iterations and are approximate.

### Geo charts and built-in maps

The service bundles TopoJSON map data, so `choropleth` and `bubbleMap` charts can reference maps **by name** — no need to inline GeoJSON or fetch anything:

| Map name | Source | Contents |
|---|---|---|
| `world` | [world-atlas](https://www.npmjs.com/package/world-atlas) | All countries (one feature per country) |
| `world-50m` | world-atlas | Higher-detail countries |
| `world-land` | world-atlas | Single land outline |
| `us` | [us-atlas](https://www.npmjs.com/package/us-atlas) | US nation outline |
| `us-states` | us-atlas | 50 states + territories |
| `us-counties` | us-atlas | ~3200 counties |
| `<iso3>` (e.g. `deu`, `fra`, `jpn`) | [datamaps](https://github.com/markmarkoh/datamaps) (vendored) | One country with its first-level subdivisions |

A complete world choropleth is just a few hundred bytes:

```jsonc
{
  "type": "choropleth",
  "data": {
    "datasets": [{
      "map": "world",                          // names the map for feature matching
      "data": [
        { "feature": "Germany", "value": 83 }, // matched by feature name
        { "feature": "France",  "value": 67 }
      ]
    }]
  }
}
```

How references are resolved:

- A string `outline` resolves to the named map's features. If only `map` is given, it doubles as the outline.
- Choropleth `data[].feature` strings are matched against the `map` (or `outline`) map's features: first by `properties.name`, then by `id`, case-insensitive.  Feature ids are ISO 3166-1 numeric codes for `world*`, FIPS codes for `us*`, and datamaps subunit codes (e.g. `DE.BE`) for `<iso3>` maps.  Names must match the source data (English short names) — `GET /maps?name=<map>` lists every matchable feature.
- When a built-in map is used, sensible defaults are filled in: the `projection`/`color`/`size` scales, `showOutline: true`, and a hidden legend.  Anything you configure explicitly is left untouched.
- Unknown map, feature, or projection names fail with HTTP 400 and an explanatory `X-quickchart-error`.
- Inline GeoJSON objects (the pre-existing behavior) still work anywhere a named reference does — use them for custom shapes.

#### Aiming the projection

A projection name on its own cannot be pointed anywhere, and d3's default view is centered on the prime meridian.  For most of the world that is wrong, and for a country whose longitudes wrap past 180° — Russia, Fiji, the US with its Aleutians — it is badly wrong: the map is fitted across the whole globe and the region ends up a sliver in the corner.  So the `projection` scale accepts three things:

```jsonc
"scales": {
  "projection": {
    "axis": "x",
    "projection": "auto",              // 1. name | "auto" | object
    "fit": { "bbox": [-25, 34, 45, 72] } // 2. what to frame the view on
  }
}
```

**1. `projection`** — a d3 projection name (`equalEarth`, `mercator`, `albersUsa`, `conicEqualArea`, …), the keyword `auto`, or an object naming the projection and aiming it:

```jsonc
"projection": {
  "type": "conicEqualArea",
  "rotate": [-100, 0],     // spin the globe so 100°E faces the viewer
  "center": [0, 65],       // then center on 65°N
  "parallels": [50, 70]    // standard parallels (conic projections only)
}
```

Also accepted: `clipAngle`, `clipExtent`, `precision`, `angle`, `reflectX`, `reflectY`.  `scale` and `translate` are not — the fit to the chart area overwrites both; use `projectionScale` (zoom factor) and `projectionOffset` (`[dx, dy]` in pixels) on the scale itself, plus `padding`, to nudge the result.

`auto` rotates to the outline's centroid meridian and picks conic standard parallels from its latitude range, falling back to `equalEarth` for near-global outlines and `albersUsa` for the US maps.  **It is the default whenever a chart uses a built-in map and does not name a projection of its own**, so `{"map": "rus"}` renders a correctly framed Russia with no options at all.  `GET /maps?name=<map>` reports the exact spec `auto` would choose, so you can copy it and adjust.

**2. `fit`** — the region the view is framed on, independent of what is drawn.  Everything outside the chart area is clipped (`clipMap`, on by default), so this is how you crop a big map down to one region:

```jsonc
"fit": [-25, 34, 45, 72]                                   // [west, south, east, north]
"fit": { "bbox": [-25, 34, 45, 72] }                       // same thing
"fit": { "map": "rus", "features": ["Amur", "Sakhalin"] }  // frame on named features
"fit": { "map": "deu" }                                    // frame on a whole map
"fit": { "type": "Polygon", "coordinates": [/* … */] }     // or inline GeoJSON
```

West may exceed east for a box past the antimeridian: `[160, 62, -172, 72]` is Chukotka.  A `features` list may mix map feature names/ids with inline GeoJSON objects; anything else in it — a number, `null` — is rejected with a 400 rather than quietly framing nothing.

A world choropleth cropped to Europe:

```jsonc
{
  "type": "choropleth",
  "data": { "datasets": [{ "map": "world", "data": [{ "feature": "Germany", "value": 83 }] }] },
  "options": {
    "scales": {
      "projection": {
        "axis": "x",
        "projection": { "type": "conicEqualArea", "rotate": [-10, 0], "center": [0, 53], "parallels": [43, 63] },
        "fit": { "bbox": [-25, 34, 45, 72] }
      },
      "color": { "axis": "x" }
    }
  }
}
```

When `fit` is given and the projection is left on `auto`, the projection is aimed at the **fit region** rather than at the whole outline — cropping a world map to the Russian Far East frames it and rotates the globe to face it.  If you name a projection yourself, aim it yourself too: `fit` only frames, and a region crossing the antimeridian is cut in half by an unrotated projection's own seam.

JS configs can access the same registry via `getMap(name)`, which returns `{ features, topology }` (alongside the existing `topojson` helper):

```js
{
  type: 'choropleth',
  data: {
    labels: getMap('us-states').features.map((f) => f.properties.name),
    datasets: [{
      outline: getMap('us-states').features,
      data: getMap('us-states').features.map((f) => ({ feature: f, value: Math.random() * 100 }))
    }]
  },
  options: { scales: { projection: { axis: 'x', projection: 'albersUsa' }, color: { axis: 'x' } } }
}
```

Discovery: `GET /maps` returns all available map names and sources as JSON.  `GET /maps?name=<map>` additionally returns the map's `features` (name/id pairs), its `bbox` (`[west, south, east, north]`) and `centroid`, and the `projection` spec that `auto` would pick for it:

```jsonc
{
  "name": "rus",
  "source": "datamaps",
  "bbox": [19.6, 41.19, -168.98, 81.86],  // east < west: this map wraps past 180°
  "centroid": [95.8, 66.04],
  "projection": { "type": "conicEqualArea", "rotate": [-95.8, 0], "center": [0, 61.53], "parallels": [47.97, 75.08] },
  "features": [{ "name": "Tomsk", "id": "RU.TO" }, ]
}
```

Note: the per-country datamaps borders are ~2015-era.  Refresh them with `node scripts/sync-datamaps.js` (see `maps/datamaps/SOURCE.md`).

## QR Codes

The service also produces QR codes.  For example, https://quickchart.io/qr?text=Hello+world produces:

![https://quickchart.io/qr?text=Hello+world](https://quickchart.io/qr?text=Hello+world)

The `/qr` endpoint has the following query parameters:
  - `text` - QR code data (required)
  - `format` - png or svg (png default)
  - `size` - size in pixels of one side of the square image (defaults to 150)
  - `margin` - size of the QR image margin in modules (defaults to 4)
  - `ecLevel` - Error correction level (defaults to M)
  - `dark` - Hex color code for dark portion of QR code (defaults to `000000`)
  - `light` - Hex color code for light portion of QR code (defauls to `ffffff`)

## Client libraries

  - [quickchart-js](https://github.com/typpo/quickchart-js) - Javascript
  - [quickchart-python](https://github.com/typpo/quickchart-python) - Python
  - [quickchart-ruby](https://github.com/typpo/quickchart-ruby) - Ruby
  - [quickchart-php](https://github.com/typpo/quickchart-php) - PHP
  - [quickchart-csharp](https://github.com/typpo/quickchart-csharp) - C#
  - [quickchart-java](https://github.com/typpo/quickchart-java) - Java
  - [chartjs-to-image](https://www.npmjs.com/package/chartjs-to-image) - Javascript package for Chart.js images

## Dependencies and Installation

Requires Node.js >= 22.12 (the first release able to `require()` an ES module, which `d3-geo` is).

Chart generation uses [node-canvas](https://github.com/Automattic/node-canvas).  Prebuilt binaries cover most platforms (Windows, macOS, glibc Linux); on Alpine/musl it compiles from source and needs Cairo, Pango, libjpeg, giflib, librsvg, and pixman development headers (see the `Dockerfile` for the exact package list).

Install node dependencies with:

```
npm install
```

## Running the server

`npm start` (or `node index.js`) starts the server on port 3400.  Set your `PORT` environment variable to change this port.

Other environment variables: `CHART_MAX_WIDTH`/`CHART_MAX_HEIGHT` (default 3000), `RATE_LIMIT_PER_MIN` (enables rate limiting on `/chart` when set), `TRUST_PROXY` (Express [trust proxy](https://expressjs.com/en/guide/behind-proxies.html) setting — `true`, a hop count, or an IP/CIDR list; set this when running behind a reverse proxy so rate limiting sees real client IPs; default is off, so `X-Forwarded-For` is ignored and cannot be spoofed), `REQUEST_TIMEOUT_MS` (default 5000), `EXPRESS_JSON_LIMIT` (default 100kb), `LOG_LEVEL`, `ENABLE_TELEMETRY` (usage telemetry is **disabled** unless this is set).

## Testing

- `npm test` runs the fast test suite (in-process rendering + HTTP tests via supertest), including a render test for every supported chart type.
- `npm run test:e2e` runs end-to-end tests with [testcontainers](https://node.testcontainers.org/): it builds the Docker image, starts a container, sends `POST /chart` requests for every basic and plugin chart type, verifies the responses, and tears the container down.  Requires a running Docker daemon.  If the testcontainers reaper fails to start on your setup, run with `TESTCONTAINERS_RYUK_DISABLED=true`.

## Docker

Tagged releases (`vX.Y.Z`) are automatically built and published as multi-arch (amd64 + arm64) images to GitHub Container Registry as `ghcr.io/<owner>/quickchart:<version>` and `:latest` (see `.github/workflows/release.yml`).  Pull requests run the full test suite, including the Docker E2E tests (`.github/workflows/ci.yml`).

#### Building

`Dockerfile` sets up a server that provides chart and qr code web endpoints.

```
docker build -t quickchart .
```

#### Running

The server runs on port 3400 within the container.  This command will expose the server on port 8080 on your host (hostport:containerport):

```
docker run -p 8080:3400 quickchart
```

## Deploy

By following the **Docker** instructions above, you can deploy the service to any platform that supports running containers.

## Securing your self-hosted instance

This server assumes all Javascript sent in the config object is friendly.  If you are hosting QuickChart yourself, take care not to expose the service to untrusted parties.  Because Chart.js configs may contain arbitrary Javascript, it is necessary to properly sandbox your QuickChart instance if you are exposing it to the outside world.

## Health and Monitoring

QuickChart has two API endpoints to determine the health of the service.

`/healthcheck` is a basic endpoint that returns a 200 status code and a JSON object that looks like this: `{"success":true,"version":"2.0.0"}`.

A second endpoint, `/healthcheck/chart` returns a 302 status code and redirects to a chart with random attributes.  Although it is a more expensive endpoint, it can be useful for cache busting or testing chart rendering.

## Differences from upstream

This fork diverges from [typpo/quickchart](https://github.com/typpo/quickchart):

- **Chart.js 4 only.** The `version` parameter is accepted but ignored.  Chart.js 2-era plugins with no maintained successor were removed: `chartjs-plugin-piechart-outlabels`, `chartjs-plugin-doughnutlabel`, `chartjs-plugin-colorschemes` (the built-in Colors plugin provides default palettes), and `chartjs-chart-radial-gauge`.  The chart types `radialGauge`, `outlabeledPie`, and `outlabeledDoughnut` are no longer available.
- **All sgratzl chart.js plugins added** (boxplot/violin, error bars, funnel, geo, graph, pcp, venn, wordcloud, hierarchical).
- **Geo charts get bundled maps and aimable projections** — see [Geo charts and built-in maps](#geo-charts-and-built-in-maps).  Projections can be rotated/centered from plain JSON, are aimed automatically for built-in maps, and the view can be framed on an arbitrary region.
- **Google Image Charts compatibility removed** (`/gchart` and `cht=` parameters).
- **Graphviz rendering removed.**
- **Client errors return 400** (upstream returns 500 for everything); `X-quickchart-error` is always populated on failures.
- **Telemetry is opt-in** (`ENABLE_TELEMETRY`); the `POST /telemetry` aggregation endpoint is removed.
- Express 5, pino logging, node-canvas 3, npm instead of yarn, Node 26 Docker base image, and a Docker-based E2E test suite.

## License

QuickChart is open source, licensed under version 3 of the GNU AGPL.  If you would like to modify this project for commercial purposes (and not release the source code), please [contact me](https://www.ianww.com/).
