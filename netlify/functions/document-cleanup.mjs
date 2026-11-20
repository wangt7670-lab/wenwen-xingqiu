import { supabase } from '../../server/api.mjs';
import { cleanExpiredDocuments } from '../../server/library.mjs';
import { duringDeployment } from '../../server/deployment.mjs';

export const config = { schedule: '0 * * * *' };

export default async (_request, context) => {
  if (context?.deploy?.context !== 'production' || context.deploy.published !== true) {
    return Response.json({ skipped: true });
  }
  try {
    const removed = await duringDeployment(context, () => cleanExpiredDocuments(supabase));
    return Response.json({ removed });
  } catch {
    return Response.json({ error: 'Cleanup unavailable' }, { status: 503 });
  }
};
