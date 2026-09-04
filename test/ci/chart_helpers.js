const { BASIC_CONFIGS, PLUGIN_CONFIGS } = require('../fixtures/chart_configs');

const BASIC_CHART = BASIC_CONFIGS.bar;

// Everything a plain JSON config can carry: a styled title, a legend, data
// labels, stacked scales and Intl-formatted ticks.
const ADVANCED_CHART = {
  type: 'bar',
  data: {
    labels: ['January', 'February', 'March', 'April', 'May'],
    datasets: [
      {
        label: 'Dogs',
        backgroundColor: 'chartreuse',
        data: [50, 60, 70, 180, 190],
      },
      {
        label: 'Cats',
        backgroundColor: 'gold',
        data: [100, 200, 300, 400, 500],
      },
    ],
  },
  options: {
    plugins: {
      title: {
        display: true,
        text: 'Total Revenue',
        color: 'hotpink',
        font: { size: 32 },
      },
      legend: {
        position: 'bottom',
      },
      datalabels: {
        display: true,
        font: {
          weight: 'bold',
        },
      },
    },
    scales: {
      x: { stacked: true },
      y: {
        stacked: true,
        ticks: {
          format: { style: 'currency', currency: 'USD', maximumFractionDigits: 0 },
        },
      },
    },
  },
};

const CHART_VIOLIN = {
  type: 'violin',
  data: {
    labels: [2012, 2013, 2014, 2015],
    datasets: [
      {
        label: 'Data',
        data: [
          [12, 6, 3, 4],
          [1, 8, 8, 15],
          [1, 1, 1, 2, 3, 5, 9, 8],
          [19, -3, 18, 8, 5, 9, 9],
        ],
        backgroundColor: 'rgba(56,123,45,0.2)',
        borderColor: 'rgba(56,123,45,1.9)',
      },
    ],
  },
};

const CHART_PROGRESSBAR = {
  type: 'progressBar',
  data: {
    datasets: [
      {
        data: [80],
      },
      {
        data: [100],
      },
    ],
  },
};

const DATETIME_CHART = {
  type: 'line',
  data: {
    labels: [
      '2020-06-14T16:08:20.288Z',
      '2020-06-15T16:08:20.288Z',
      '2020-06-16T16:08:20.289Z',
      '2020-06-17T16:08:20.289Z',
      '2020-06-18T16:08:20.289Z',
      '2020-06-19T16:08:20.289Z',
      '2020-06-20T16:08:20.289Z',
    ],
    datasets: [
      {
        label: 'My First dataset',
        backgroundColor: 'rgba(255, 99, 132, 0.5)',
        borderColor: 'rgb(255, 99, 132)',
        fill: false,
        data: [38, -19, 35, -2, 77, 78, -93],
      },
      {
        label: 'Dataset with point data',
        backgroundColor: 'rgba(75, 192, 192, 0.5)',
        borderColor: 'rgb(75, 192, 192)',
        fill: false,
        data: [
          { x: '06/14/2020 09:08', y: -29 },
          { x: '06/19/2020 09:08', y: -34 },
          { x: '06/21/2020 09:08', y: -62 },
        ],
      },
    ],
  },
  options: {
    scales: {
      x: {
        type: 'time',
        time: {
          parser: 'MM/DD/YYYY HH:mm',
        },
        title: {
          display: true,
          text: 'Date',
        },
      },
      y: {
        title: {
          display: true,
          text: 'value',
        },
      },
    },
  },
};

module.exports = {
  BASIC_CHART,
  BASIC_CONFIGS,
  PLUGIN_CONFIGS,
  ADVANCED_CHART,
  CHART_VIOLIN,
  CHART_PROGRESSBAR,
  DATETIME_CHART,
};
