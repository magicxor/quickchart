/**
 * @upsetjs/venn.js 2.0.0 (dependency of chartjs-chart-venn) declares
 * `exports["."].require = "./build/index.js"`, but that file is missing from
 * the published tarball, which breaks require() of chartjs-chart-venn.
 *
 * The shipped UMD bundle (build/venn.js) is CommonJS-compatible, so copy it to
 * build/venn.cjs (the .cjs extension forces CJS interpretation inside this
 * "type": "module" package) and point the require condition at it.
 *
 * Runs as a postinstall hook. Idempotent.
 */
const fs = require('fs');
const path = require('path');

const candidates = [
  path.join(__dirname, '..', 'node_modules', '@upsetjs', 'venn.js'),
  path.join(
    __dirname,
    '..',
    'node_modules',
    'chartjs-chart-venn',
    'node_modules',
    '@upsetjs',
    'venn.js',
  ),
];

let patched = false;
for (const pkgDir of candidates) {
  const pkgJsonPath = path.join(pkgDir, 'package.json');
  if (!fs.existsSync(pkgJsonPath)) {
    continue;
  }
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
  const requireTarget = pkg.exports && pkg.exports['.'] && pkg.exports['.'].require;
  if (!requireTarget || fs.existsSync(path.join(pkgDir, requireTarget))) {
    patched = true; // nothing to do
    continue;
  }
  const umdBuild = path.join(pkgDir, 'build', 'venn.js');
  if (!fs.existsSync(umdBuild)) {
    console.error(`patch-upsetjs-venn: expected UMD build not found at ${umdBuild}`);
    process.exit(1);
  }
  fs.copyFileSync(umdBuild, path.join(pkgDir, 'build', 'venn.cjs'));
  pkg.exports['.'].require = './build/venn.cjs';
  pkg.main = './build/venn.cjs';
  fs.writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, 2));
  console.log(`patch-upsetjs-venn: patched ${pkgDir}`);
  patched = true;
}

if (!patched) {
  console.warn('patch-upsetjs-venn: @upsetjs/venn.js not found; skipping');
}
