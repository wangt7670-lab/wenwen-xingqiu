import assert from 'node:assert/strict';
import { test } from 'node:test';
import api from '../netlify/functions/api.mjs';
import cleanup from '../netlify/functions/document-cleanup.mjs';
import { deploymentConfig } from '../server/deployment.mjs';

const preview = { deploy: { context: 'deploy-preview', published: false } };
const production = { deploy: { context: 'production', published: true } };
const env = {
  SITE_ID: 'fake-site',
  SUPABASE_URL: 'https://production-project.supabase.co',
  SUPABASE_SECRET_KEY: 'production-test-value',
  PREVIEW_SUPABASE_URL: 'https://isolated-project.supabase.co',
  PREVIEW_SUPABASE_SECRET_KEY: 'isolated-test-value'
};

test('preview configuration fails closed for missing or shared Supabase credentials', () => {
  const missing = { ...env, PREVIEW_SUPABASE_SECRET_KEY: undefined };
  assert.equal(deploymentConfig(missing, preview).url, undefined);
  assert.equal(deploymentConfig({ ...env, PREVIEW_SUPABASE_URL: env.SUPABASE_URL + './' }, preview).url, undefined);
  assert.equal(deploymentConfig({ ...env, PREVIEW_SUPABASE_SECRET_KEY: env.SUPABASE_SECRET_KEY }, preview).url, undefined);
  assert.equal(deploymentConfig({ ...env, SUPABASE_URL: undefined }, preview).url, undefined);
  assert.equal(deploymentConfig({ ...env, SUPABASE_URL: undefined, PRODUCTION_SUPABASE_HOST: 'production-project.supabase.co' }, preview).url, env.PREVIEW_SUPABASE_URL);
  assert.equal(deploymentConfig(env, production).url, env.SUPABASE_URL);
  assert.equal(deploymentConfig(missing, undefined).url, undefined);
});

test('Netlify handlers keep independent targets and never run the production cleanup in previews', async () => {
  const previousEnv = process.env;
  const previousFetch = globalThis.fetch;
  const request = new Request('https://quiz.example/api/health');
  const network = [];
  try {
    process.env = { ...previousEnv, ...env, PREVIEW_SUPABASE_SECRET_KEY: '' };
    globalThis.fetch = async (url, options) => {
      network.push({ host: new URL(url).hostname, key: options.headers.apikey });
      return Response.json([]);
    };
    assert.equal((await (await api(request, preview)).json()).onlineReady, false);
    assert.deepEqual(await (await cleanup(request, preview)).json(), { skipped: true });
    assert.equal(network.length, 0);
    process.env.PREVIEW_SUPABASE_SECRET_KEY = env.PREVIEW_SUPABASE_SECRET_KEY;
    const [stage, live] = await Promise.all([api(request, preview), api(request, production)]);
    assert.equal((await stage.json()).deploymentContext, 'deploy-preview');
    assert.equal((await live.json()).deploymentContext, 'production');
    assert.deepEqual(network, [
      { host: 'isolated-project.supabase.co', key: env.PREVIEW_SUPABASE_SECRET_KEY },
      { host: 'production-project.supabase.co', key: env.SUPABASE_SECRET_KEY }
    ]);
  } finally {
    process.env = previousEnv;
    globalThis.fetch = previousFetch;
  }
});
