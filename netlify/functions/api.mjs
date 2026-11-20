import { handleApi } from '../../server/api.mjs';
import { duringDeployment } from '../../server/deployment.mjs';

// Modern Netlify Functions API. Netlify resolves /api/health, /api/rooms, etc.
export const config = { path: '/api/*' };
export default async function handler(request, context) {
  return duringDeployment(context, () => handleApi(request));
}
