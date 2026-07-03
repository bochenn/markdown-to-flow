// Inline de los íconos de Figma UI3 en la UI del plugin: src/ui.html usa
// placeholders <!-- ICON:nombre --> o <!-- ICON:nombre:tamaño --> y acá se
// reemplazan por el SVG leído de Resources/figma-UI3 (single source de
// íconos del proyecto). El iframe no puede fetchear archivos, y el manifest
// tiene networkAccess "none": todo va embebido en dist/ui.html.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const BASE = 'Resources/figma-UI3';

function svgDe(nombre, px) {
  // caso especial: el spinner de 16 vive en _Doc/
  const ruta = nombre === 'icon.16.loading' ? `${BASE}/_Doc/${nombre}.svg` : `${BASE}/${nombre}.svg`;
  let svg = readFileSync(ruta, 'utf8').replace(/<\?xml[^>]*\?>\s*/, '').trim();
  if (px) {
    svg = svg
      .replace(/width="\d+"/, `width="${px}"`)
      .replace(/height="\d+"/, `height="${px}"`);
  }
  return svg;
}

let html = readFileSync('src/ui.html', 'utf8');
let reemplazos = 0;
html = html.replace(/<!-- ICON:([\w.]+?)(?::(\d+))? -->/g, (_, nombre, px) => {
  reemplazos++;
  return svgDe(nombre, px ? Number(px) : undefined);
});
if (reemplazos === 0) {
  throw new Error('no se encontró ningún placeholder <!-- ICON:... --> en src/ui.html');
}

mkdirSync('dist', { recursive: true });
writeFileSync('dist/ui.html', html);
console.log(`dist/ui.html generado (${Math.round(html.length / 1024)}KB, ${reemplazos} íconos UI3 inline)`);
