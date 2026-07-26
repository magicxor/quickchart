# Map data source

The `*.topo.json` files in this directory are vendored from
[markmarkoh/datamaps](https://github.com/markmarkoh/datamaps) (`src/js/data/`), pinned to commit
`14c1641273bb52e6f115f99db847ec076c62eb4b`.

Each file is a compact TopoJSON of one country with its first-level
subdivisions; the filename is the country's ISO 3166-1 alpha-3 code. Borders
reflect the state of the datamaps project (~2015 era).

To refresh or re-pin, edit `PINNED_COMMIT` in `scripts/sync-datamaps.js` and
run `node scripts/sync-datamaps.js`.

## License (MIT, from the datamaps repository)

```
The MIT License (MIT)
Copyright (c) 2012 Mark DiMarco

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```
