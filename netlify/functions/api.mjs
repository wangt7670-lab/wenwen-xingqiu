import { handleApi } from '../../server/api.mjs';

// Modern Netlify Functions API. Netlify resolves /api/health, /api/rooms, etc.
export const config = { path: '/api/*' };
export default async function handler(request) {
  return handleApi(request);
}
