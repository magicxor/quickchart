const canvas = require('canvas');
const { Path2D, applyPath2DToCanvasRenderingContext } = require('path2d');

// node-canvas has no native Path2D; the path2d package provides one and
// patches ctx.fill/stroke/clip/isPointInPath to accept it. Needed by
// chartjs-chart-venn for exact arc-slice shapes.
applyPath2DToCanvasRenderingContext(canvas.CanvasRenderingContext2D);
global.Path2D = global.Path2D || Path2D;

// Environment shims for chart plugins that expect browser globals.
if (typeof global.document === 'undefined') {
  // d3-cloud (chartjs-chart-wordcloud) measures text on a DOM canvas.
  global.document = {
    createElement: () => canvas.createCanvas(1, 1),
  };
}
if (typeof global.requestAnimationFrame === 'undefined') {
  // chartjs-chart-graph schedules its layout passes with requestAnimationFrame.
  global.requestAnimationFrame = (cb) => setImmediate(() => cb(Date.now()));
  global.cancelAnimationFrame = (handle) => clearImmediate(handle);
}
if (typeof global.window === 'undefined') {
  // chartjs-chart-venn probes window.Path2D at draw time. Note that defining
  // `window` makes chart.js think a DOM exists - the renderer neutralizes that
  // by forcing BasicPlatform on every chart it creates.
  global.window = {
    Path2D: global.Path2D,
    requestAnimationFrame: global.requestAnimationFrame,
  };
}

const { Chart, registerables, BasicPlatform } = require('chart.js');

const annotationPlugin = require('chartjs-plugin-annotation');
const chartDataLabels = require('chartjs-plugin-datalabels');
const {
  BoxPlotController,
  ViolinController,
  BoxAndWiskers,
  Violin,
} = require('@sgratzl/chartjs-chart-boxplot');
const {
  BarWithErrorBarsController,
  LineWithErrorBarsController,
  ScatterWithErrorBarsController,
  PolarAreaWithErrorBarsController,
  BarWithErrorBar,
  PointWithErrorBar,
  ArcWithErrorBar,
} = require('chartjs-chart-error-bars');
const { FunnelController, TrapezoidElement } = require('chartjs-chart-funnel');
const {
  ChoroplethController,
  BubbleMapController,
  GeoFeature,
  ColorScale,
  ColorLogarithmicScale,
  ProjectionScale,
  SizeScale,
  SizeLogarithmicScale,
  topojson,
} = require('chartjs-chart-geo');
const {
  GraphController,
  ForceDirectedGraphController,
  DendrogramController,
  TreeController,
  EdgeLine,
} = require('chartjs-chart-graph');
const {
  ParallelCoordinatesController,
  LogarithmicParallelCoordinatesController,
  PCPScale,
  LinearAxis,
  LogarithmicAxis,
  LineSegment,
} = require('chartjs-chart-pcp');
// Requires the @upsetjs/venn.js packaging fix applied by
// scripts/patch-upsetjs-venn.js (npm postinstall).
const { VennDiagramController, EulerDiagramController, ArcSlice } = require('chartjs-chart-venn');
const { WordCloudController, WordElement } = require('chartjs-chart-wordcloud');
const { HierarchicalScale } = require('chartjs-plugin-hierarchical');

const { defaultFormatter } = require('./datalabels');

// `registerables` includes all built-in controllers, elements, scales, and
// plugins - notably the Colors plugin that assigns default dataset colors.
Chart.register(
  ...registerables,
  annotationPlugin,
  chartDataLabels,
  // @sgratzl/chartjs-chart-boxplot: 'boxplot', 'violin'
  BoxPlotController,
  ViolinController,
  BoxAndWiskers,
  Violin,
  // chartjs-chart-error-bars: 'barWithErrorBars', 'lineWithErrorBars',
  // 'scatterWithErrorBars', 'polarAreaWithErrorBars'
  BarWithErrorBarsController,
  LineWithErrorBarsController,
  ScatterWithErrorBarsController,
  PolarAreaWithErrorBarsController,
  BarWithErrorBar,
  PointWithErrorBar,
  ArcWithErrorBar,
  // chartjs-chart-funnel: 'funnel'
  FunnelController,
  TrapezoidElement,
  // chartjs-chart-geo: 'choropleth', 'bubbleMap'
  ChoroplethController,
  BubbleMapController,
  GeoFeature,
  ColorScale,
  ColorLogarithmicScale,
  ProjectionScale,
  SizeScale,
  SizeLogarithmicScale,
  // chartjs-chart-graph: 'graph', 'forceDirectedGraph', 'dendrogram', 'tree'
  GraphController,
  ForceDirectedGraphController,
  DendrogramController,
  TreeController,
  EdgeLine,
  // chartjs-chart-pcp: 'pcp', 'logarithmicPcp'
  ParallelCoordinatesController,
  LogarithmicParallelCoordinatesController,
  PCPScale,
  LineSegment,
  // chartjs-chart-venn: 'venn', 'euler'
  VennDiagramController,
  EulerDiagramController,
  ArcSlice,
  // chartjs-chart-wordcloud: 'wordCloud'
  WordCloudController,
  WordElement,
  // chartjs-plugin-hierarchical: scale type 'hierarchical'
  HierarchicalScale,
);

// The pcp axis classes subclass scales but are looked up as *elements* by the
// pcp controller, so Chart.register() would file them in the wrong registry.
Chart.registry.addElements(LinearAxis, LogarithmicAxis);

// Replaces the datalabels key-listing default, which stringifies the object
// data of geo and {x, y} datasets into "[object Object]" (see ./datalabels).
Chart.defaults.plugins.datalabels.formatter = defaultFormatter;

// Side effect: registers the moment date adapter for time scales. Must run
// after chart.js has been loaded.
require('chartjs-adapter-moment');

module.exports = {
  Chart,
  BasicPlatform,
  topojson,
};
