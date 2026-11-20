import { AsyncLocalStorage } from 'node:async_hooks';

const deployment = new AsyncLocalStorage();

function hostname(value) {
  try { return new URL(value).hostname.replace(/\.$/, ''); }
  catch { return ''; }
}

export function deploymentConfig(env, context) {
  const name = context?.deploy?.context || (env.SITE_ID ? 'unknown' : 'dev');
  const production = name === 'production';
  const isolated = !production && name !== 'dev';
  const normalUrl = env.SUPABASE_URL?.trim();
  const normalKey = env.SUPABASE_SECRET_KEY?.trim();
  if (!isolated) return { name, production, url: normalUrl, key: normalKey };

  const url = env.PREVIEW_SUPABASE_URL?.trim();
  const key = env.PREVIEW_SUPABASE_SECRET_KEY?.trim();
  const host = hostname(url);
  const productionHost = env.PRODUCTION_SUPABASE_HOST?.trim().toLowerCase().replace(/\.$/, '') || hostname(normalUrl);
  const permitted = url?.startsWith('https://') && host && productionHost && host !== productionHost &&
    host !== hostname(normalUrl) && key && key !== normalKey;
  return permitted ? { name, production, url, key } : { name, production };
}

export function duringDeployment(context, operation) {
  return deployment.run(deploymentConfig(process.env, context), operation);
}

export function backendConfig() {
  return deployment.getStore() ?? deploymentConfig(process.env);
}
