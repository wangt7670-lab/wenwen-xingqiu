import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const variables = ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'PREVIEW_SUPABASE_URL', 'PREVIEW_SUPABASE_SECRET_KEY'];
for (const name of variables) {
  if (variables.includes(process.env[name]?.trim())) {
    throw Error(`Netlify variable ${name} contains a variable name. Set its real value in the matching deploy context.`);
  }
}

const vendor = new URL('../public/vendor/', import.meta.url);
await mkdir(vendor, { recursive: true });
await copyFile(fileURLToPath(import.meta.resolve('@mlc-ai/web-llm')), new URL('web-llm.js', vendor));
