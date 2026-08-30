import { compile } from 'tailwindcss';
const theme = `@import "tailwindcss";
@theme inline {
  --spacing-1: 2px; --spacing-2: 4px; --spacing-3: 8px;
  --spacing-4: 12px; --spacing-5: 16px; --spacing-6: 24px;
  --spacing-7: 32px; --spacing-8: 40px; --spacing-9: 48px;
  --spacing-10: 64px;
}`;
const c = await compile(theme, { base: process.cwd(), loadStylesheet: async (id, base) => {
  const { readFileSync } = await import('node:fs');
  const p = process.cwd()+'/node_modules/tailwindcss/index.css';
  return { base, path: p, content: readFileSync(p,'utf8') };
}});
const classes = ['px-3','px-4','px-5','py-1.5','py-2','py-2.5','py-3','py-3.5','p-3','p-3.5','p-4','p-5','h-3','h-3.5','h-4','h-5','h-8','h-10','h-12','min-h-8','min-h-10','space-y-1.5','space-y-2.5','px-2.5'];
const out = c.build(classes);
for (const cl of classes) {
  const esc = cl.replace(/[.]/g,'\\.');
  const re = new RegExp('\.'+esc+'\s*\{([^}]*)\}');
  const m = out.match(re);
  console.log(cl.padEnd(12), m ? m[1].trim().replace(/\s+/g,' ') : 'NOT FOUND');
}
