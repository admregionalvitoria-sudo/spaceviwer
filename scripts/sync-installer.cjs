const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const { version } = require('../package.json');
const name = `SpaceViewer-Setup-${version}.exe`;
const source = path.join(root, 'dist-package', name);
if (!fs.existsSync(source)) throw new Error(`Instalador não encontrado: ${source}`);
for (const output of ['dist-electron', 'dist-installer']) {
  const directory = path.join(root, output);
  fs.mkdirSync(directory, { recursive: true });
  fs.copyFileSync(source, path.join(directory, name));
}
console.log(`Instalador ${version} sincronizado em dist-package, dist-electron e dist-installer.`);
