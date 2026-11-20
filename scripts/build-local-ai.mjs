import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const vendor = new URL('../public/vendor/', import.meta.url);
await mkdir(vendor, { recursive: true });
await copyFile(fileURLToPath(import.meta.resolve('@mlc-ai/web-llm')), new URL('web-llm.js', vendor));
