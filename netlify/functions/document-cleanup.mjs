import { supabase } from '../../server/api.mjs';
import { cleanExpiredDocuments } from '../../server/library.mjs';

export const config = { schedule: '0 * * * *' };

export default async () => {
  try {
    const removed = await cleanExpiredDocuments(supabase);
    return Response.json({ removed });
  } catch {
    return Response.json({ error: 'Cleanup unavailable' }, { status: 503 });
  }
};
