// Inline de FigUI3 en la UI del plugin: el manifest tiene networkAccess
// "none" (sin red en el iframe), así que la librería se bundlea localmente
// desde node_modules en vez de cargarse por CDN.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const css = readFileSync('node_modules/@rogieking/figui3/dist/fig.css', 'utf8');
const js = readFileSync('node_modules/@rogieking/figui3/dist/fig.js', 'utf8');
if (js.includes('</script')) {
  throw new Error('fig.js contiene "</script>": no se puede inlinear sin escaparlo');
}

let html = readFileSync('src/ui.html', 'utf8');
const conCss = html.replace('<!-- FIGUI3:CSS -->', () => '<style>\n' + css + '\n</style>');
const conJs = conCss.replace('<!-- FIGUI3:JS -->', () => '<script type="module">\n' + js + '\n</script>');
if (conJs === html || conCss === html) {
  throw new Error('faltan los placeholders <!-- FIGUI3:CSS --> / <!-- FIGUI3:JS --> en src/ui.html');
}

mkdirSync('dist', { recursive: true });
writeFileSync('dist/ui.html', conJs);
console.log(`dist/ui.html generado (${Math.round(conJs.length / 1024)}KB, FigUI3 inline)`);
