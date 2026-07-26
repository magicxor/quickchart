/* eslint-env node, mocha */

const assert = require('assert');

const { imageSize } = require('image-size');

const { renderTextToPng } = require('../../lib/text');

describe('text.js', () => {
  it('renders multi-line text to a png', () => {
    const buf = renderTextToPng('Chart Error: something\nwent wrong');
    const dimensions = imageSize(buf);
    assert(dimensions.width > 0);
    assert(dimensions.height > 0);
  });

  it('keeps the canvas bounded for very long input', () => {
    const longLine = 'x'.repeat(100000);
    const manyLines = Array(1000).fill('line').join('\n');

    const bufWide = renderTextToPng(longLine);
    const wide = imageSize(bufWide);
    assert(wide.width <= 2000, `width ${wide.width} exceeds bound`);

    const bufTall = renderTextToPng(manyLines);
    const tall = imageSize(bufTall);
    assert(tall.height <= 1000, `height ${tall.height} exceeds bound`);
  });
});
