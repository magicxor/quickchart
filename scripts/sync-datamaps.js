/**
 * Vendors per-country TopoJSON maps from markmarkoh/datamaps (MIT) into
 * maps/datamaps/. The files are committed to git so builds stay hermetic -
 * this script exists only to refresh the data or re-pin the source commit.
 *
 * Only `<iso3>.topo.json` files are taken (one compact TopoJSON per country).
 * The aggregate maps (world.topo.json, world.hires.topo.json, _nul.topo.json)
 * are skipped: world maps come from the world-atlas npm package instead, and
 * the fat `<iso3>.json` GeoJSON twins are redundant.
 *
 * Usage: node scripts/sync-datamaps.js
 * Idempotent; re-downloads everything and rewrites SOURCE.md.
 */
const fs = require('fs');
const path = require('path');

// Update this hash to re-pin. SOURCE.md records the value that was synced.
const PINNED_COMMIT = '14c1641273bb52e6f115f99db847ec076c62eb4b';

const REPO = 'markmarkoh/datamaps';
const DATA_DIR = 'src/js/data';
const OUT_DIR = path.join(__dirname, '..', 'maps', 'datamaps');
const CONCURRENCY = 16;

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'quickchart-sync-datamaps' } });
  if (!res.ok) {
    throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'quickchart-sync-datamaps' } });
  if (!res.ok) {
    throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

async function listTopoFiles() {
  const tree = await fetchJson(
    `https://api.github.com/repos/${REPO}/git/trees/${PINNED_COMMIT}?recursive=1`,
  );
  if (tree.truncated) {
    throw new Error('GitHub tree listing was truncated; adjust the script to walk subtrees');
  }
  return tree.tree
    .filter(
      (entry) =>
        entry.type === 'blob' &&
        entry.path.startsWith(`${DATA_DIR}/`) &&
        /^[a-z]{3}\.topo\.json$/.test(path.posix.basename(entry.path)),
    )
    .map((entry) => path.posix.basename(entry.path))
    .sort();
}

// Sanity-check the TopoJSON shape the loader relies on: a single object whose
// geometries carry an `id` and `properties.name` for feature matching.
function validateTopology(name, raw) {
  const topology = JSON.parse(raw);
  if (topology.type !== 'Topology' || !topology.objects) {
    throw new Error(`${name}: not a TopoJSON Topology`);
  }
  const keys = Object.keys(topology.objects);
  if (keys.length !== 1) {
    throw new Error(`${name}: expected exactly 1 object key, got ${keys.join(', ')}`);
  }
  const geometries = topology.objects[keys[0]].geometries || [];
  if (geometries.length === 0) {
    throw new Error(`${name}: no geometries`);
  }
}

async function syncFile(filename) {
  const url = `https://raw.githubusercontent.com/${REPO}/${PINNED_COMMIT}/${DATA_DIR}/${filename}`;
  const raw = await fetchText(url);
  validateTopology(filename, raw);
  fs.writeFileSync(path.join(OUT_DIR, filename), raw);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const files = await listTopoFiles();
  console.log(`Syncing ${files.length} country maps from ${REPO}@${PINNED_COMMIT}`);

  const queue = [...files];
  let done = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length > 0) {
      const filename = queue.shift();
      // eslint-disable-next-line no-await-in-loop
      await syncFile(filename);
      done += 1;
      if (done % 50 === 0) {
        console.log(`  ${done}/${files.length}`);
      }
    }
  });
  await Promise.all(workers);

  const license = await fetchText(
    `https://raw.githubusercontent.com/${REPO}/${PINNED_COMMIT}/LICENSE`,
  );
  const sourceMd = `# Map data source

The \`*.topo.json\` files in this directory are vendored from
[${REPO}](https://github.com/${REPO}) (\`${DATA_DIR}/\`), pinned to commit
\`${PINNED_COMMIT}\`.

Each file is a compact TopoJSON of one country with its first-level
subdivisions; the filename is the country's ISO 3166-1 alpha-3 code. Borders
reflect the state of the datamaps project (~2015 era).

To refresh or re-pin, edit \`PINNED_COMMIT\` in \`scripts/sync-datamaps.js\` and
run \`node scripts/sync-datamaps.js\`.

## License (MIT, from the datamaps repository)

\`\`\`
${license.trim()}
\`\`\`
`;
  fs.writeFileSync(path.join(OUT_DIR, 'SOURCE.md'), sourceMd);
  console.log(`Done: ${files.length} maps + SOURCE.md written to ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
