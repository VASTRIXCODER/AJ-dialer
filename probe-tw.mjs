import postcss from 'postcss';
import tw from '@tailwindcss/postcss';
import fs from 'node:fs';
const css = fs.readFileSync('src/app/globals.css','utf8');
const out = await postcss([tw()]).process(css, { from: 'src/app/globals.css', to: 'out.css' });
fs.writeFileSync('probe-out.css', out.css);
console.log('len', out.css.length);
