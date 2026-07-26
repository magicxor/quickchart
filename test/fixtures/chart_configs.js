/**
 * Chart configurations shared by the in-process render tests (test/ci) and the
 * Docker E2E suite (test/e2e). Everything here must be JSON-serializable so it
 * can be POSTed to the API as-is.
 */

// A tiny inline GeoJSON feature so geo charts render without network access.
const SQUARE_FEATURE = {
  type: 'Feature',
  properties: { name: 'Square' },
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
    ],
  },
};

const SQUARE_FEATURE_2 = {
  type: 'Feature',
  properties: { name: 'Square2' },
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [10, 0],
        [20, 0],
        [20, 10],
        [10, 10],
        [10, 0],
      ],
    ],
  },
};

const BASIC_CONFIGS = {
  bar: {
    type: 'bar',
    data: {
      labels: [2012, 2013, 2014, 2015, 2016],
      datasets: [{ label: 'Bananas', data: [4, 8, 16, 5, 5] }],
    },
  },
  line: {
    type: 'line',
    data: {
      labels: ['Jan', 'Feb', 'Mar', 'Apr'],
      datasets: [
        { label: 'A', data: [3, 5, 4, 8] },
        { label: 'B', data: [1, 4, 2, 6] },
      ],
    },
  },
  pie: {
    type: 'pie',
    data: {
      labels: ['Red', 'Blue', 'Yellow'],
      datasets: [{ data: [30, 50, 20] }],
    },
  },
  doughnut: {
    type: 'doughnut',
    data: {
      labels: ['Red', 'Blue', 'Yellow'],
      datasets: [{ data: [30, 50, 20] }],
    },
  },
  // QuickChart accepts the 'donut' spelling too.
  donut: {
    type: 'donut',
    data: {
      labels: ['Red', 'Blue'],
      datasets: [{ data: [55, 45] }],
    },
  },
  radar: {
    type: 'radar',
    data: {
      labels: ['a', 'b', 'c', 'd', 'e'],
      datasets: [{ label: 'r', data: [3, 1, 4, 1, 5] }],
    },
  },
  polarArea: {
    type: 'polarArea',
    data: {
      labels: ['a', 'b', 'c'],
      datasets: [{ data: [11, 16, 7] }],
    },
  },
  scatter: {
    type: 'scatter',
    data: {
      datasets: [
        {
          label: 's',
          data: [
            { x: 1, y: 2 },
            { x: 3, y: 7 },
            { x: 5, y: 4 },
          ],
        },
      ],
    },
  },
  bubble: {
    type: 'bubble',
    data: {
      datasets: [
        {
          label: 'b',
          data: [
            { x: 1, y: 2, r: 5 },
            { x: 3, y: 7, r: 10 },
          ],
        },
      ],
    },
  },
  // QuickChart custom types.
  sparkline: {
    type: 'sparkline',
    data: { datasets: [{ data: [10, 12, 8, 14, 9, 13] }] },
  },
  progressBar: {
    type: 'progressBar',
    data: { datasets: [{ data: [80] }] },
  },
  timeLine: {
    type: 'line',
    data: {
      labels: ['06/14/2020 09:08', '06/15/2020 09:08', '06/16/2020 09:08'],
      datasets: [{ label: 'ts', data: [3, 7, 4], fill: false }],
    },
    options: {
      scales: {
        x: {
          type: 'time',
          time: { parser: 'MM/DD/YYYY HH:mm' },
        },
      },
    },
  },
};

const PLUGIN_CONFIGS = {
  // @sgratzl/chartjs-chart-boxplot
  boxplot: {
    type: 'boxplot',
    data: {
      labels: ['A', 'B'],
      datasets: [
        {
          label: 'ds',
          data: [
            [1, 2, 3, 4, 5, 6, 7, 8],
            [2, 4, 6, 8, 10, 12],
          ],
        },
      ],
    },
  },
  horizontalBoxplot: {
    type: 'horizontalBoxplot',
    data: {
      labels: ['A', 'B'],
      datasets: [
        {
          label: 'ds',
          data: [
            [1, 2, 3, 4, 5],
            [2, 4, 6, 8, 10],
          ],
        },
      ],
    },
  },
  violin: {
    type: 'violin',
    data: {
      labels: [2012, 2013],
      datasets: [
        {
          label: 'ds',
          data: [
            [12, 6, 3, 4, 1, 8],
            [1, 1, 2, 3, 5, 9, 8],
          ],
        },
      ],
    },
  },
  // chartjs-chart-error-bars
  barWithErrorBars: {
    type: 'barWithErrorBars',
    data: {
      labels: ['A', 'B'],
      datasets: [
        {
          data: [
            { y: 4, yMin: 1, yMax: 6 },
            { y: 2, yMin: 1, yMax: 4 },
          ],
        },
      ],
    },
  },
  lineWithErrorBars: {
    type: 'lineWithErrorBars',
    data: {
      labels: ['A', 'B', 'C'],
      datasets: [
        {
          data: [
            { y: 4, yMin: 1, yMax: 6 },
            { y: 2, yMin: 1, yMax: 4 },
            { y: 5, yMin: 3, yMax: 7 },
          ],
        },
      ],
    },
  },
  scatterWithErrorBars: {
    type: 'scatterWithErrorBars',
    data: {
      datasets: [
        {
          data: [{ x: 2, y: 4, xMin: 1, xMax: 3, yMin: 2, yMax: 6 }],
        },
      ],
    },
  },
  // chartjs-chart-funnel
  funnel: {
    type: 'funnel',
    data: {
      labels: ['Step 1', 'Step 2', 'Step 3'],
      datasets: [{ data: [100, 60, 30] }],
    },
  },
  // chartjs-chart-geo
  choropleth: {
    type: 'choropleth',
    data: {
      labels: ['Square', 'Square2'],
      datasets: [
        {
          outline: [SQUARE_FEATURE, SQUARE_FEATURE_2],
          data: [
            { feature: SQUARE_FEATURE, value: 3 },
            { feature: SQUARE_FEATURE_2, value: 8 },
          ],
        },
      ],
    },
    options: {
      scales: {
        projection: { axis: 'x', projection: 'equalEarth' },
        color: { axis: 'x' },
      },
    },
  },
  bubbleMap: {
    type: 'bubbleMap',
    data: {
      labels: ['P1', 'P2'],
      datasets: [
        {
          outline: [SQUARE_FEATURE, SQUARE_FEATURE_2],
          showOutline: true,
          data: [
            { longitude: 2, latitude: 2, value: 5 },
            { longitude: 15, latitude: 8, value: 9 },
          ],
        },
      ],
    },
    options: {
      scales: {
        projection: { axis: 'x', projection: 'equalEarth' },
        size: { axis: 'x' },
      },
    },
  },
  // chartjs-chart-graph
  graph: {
    type: 'graph',
    data: {
      labels: ['A', 'B', 'C'],
      datasets: [
        {
          data: [
            { x: 1, y: 2 },
            { x: 3, y: 1 },
            { x: 2, y: 3 },
          ],
          edges: [
            { source: 0, target: 1 },
            { source: 0, target: 2 },
          ],
        },
      ],
    },
  },
  forceDirectedGraph: {
    type: 'forceDirectedGraph',
    data: {
      labels: ['A', 'B', 'C', 'D'],
      datasets: [
        {
          data: [{}, {}, {}, {}],
          edges: [
            { source: 0, target: 1 },
            { source: 0, target: 2 },
            { source: 1, target: 3 },
          ],
        },
      ],
    },
  },
  tree: {
    type: 'tree',
    data: {
      labels: ['Root', 'Child 1', 'Child 2', 'Grandchild'],
      datasets: [
        {
          data: [{}, { parent: 0 }, { parent: 0 }, { parent: 1 }],
        },
      ],
    },
  },
  // chartjs-chart-pcp: one dataset per axis/attribute.
  pcp: {
    type: 'pcp',
    data: {
      labels: ['item1', 'item2', 'item3'],
      datasets: [
        { label: 'f1', data: [5, 2, 9] },
        { label: 'f2', data: [1, 7, 4] },
        { label: 'f3', data: [8, 3, 6] },
      ],
    },
  },
  // chartjs-chart-venn
  venn: {
    type: 'venn',
    data: {
      labels: ['A', 'B', 'A n B'],
      datasets: [
        {
          label: 'Sets',
          data: [
            { sets: ['A'], value: 12 },
            { sets: ['B'], value: 8 },
            { sets: ['A', 'B'], value: 3 },
          ],
        },
      ],
    },
  },
  euler: {
    type: 'euler',
    data: {
      labels: ['A', 'B', 'A n B'],
      datasets: [
        {
          label: 'Sets',
          data: [
            { sets: ['A'], value: 12 },
            { sets: ['B'], value: 8 },
            { sets: ['A', 'B'], value: 3 },
          ],
        },
      ],
    },
  },
  // chartjs-chart-wordcloud: data values are font sizes in pixels.
  wordCloud: {
    type: 'wordCloud',
    data: {
      labels: ['Hello', 'world', 'normally', 'you', 'want', 'more', 'words'],
      datasets: [{ label: 'wc', data: [90, 60, 45, 30, 25, 20, 20] }],
    },
  },
  // chartjs-plugin-hierarchical: expandable/collapsible category axis.
  hierarchicalBar: {
    type: 'bar',
    data: {
      labels: ['A', { label: 'B', expand: true, children: ['B1', 'B2'] }, 'C'],
      datasets: [
        {
          label: 'ds',
          tree: [1, { value: 2, children: [3, 4] }, 5],
          data: [],
        },
      ],
    },
    options: {
      layout: {
        padding: { bottom: 45 },
      },
      scales: {
        x: { type: 'hierarchical' },
      },
    },
  },
  // chartjs-plugin-annotation
  annotation: {
    type: 'line',
    data: {
      labels: [1, 2, 3, 4],
      datasets: [{ label: 'd', data: [2, 4, 3, 5] }],
    },
    options: {
      plugins: {
        annotation: {
          annotations: {
            box1: {
              type: 'box',
              xMin: 1,
              xMax: 2,
              yMin: 2,
              yMax: 4,
              backgroundColor: 'rgba(255, 99, 132, 0.25)',
            },
          },
        },
      },
    },
  },
  // chartjs-plugin-datalabels
  datalabels: {
    type: 'bar',
    data: {
      labels: ['a', 'b'],
      datasets: [{ label: 'd', data: [1, 2] }],
    },
    options: {
      plugins: {
        datalabels: {
          display: true,
          color: '#000',
          anchor: 'end',
          align: 'top',
        },
      },
    },
  },
};

module.exports = {
  BASIC_CONFIGS,
  PLUGIN_CONFIGS,
  SQUARE_FEATURE,
};
