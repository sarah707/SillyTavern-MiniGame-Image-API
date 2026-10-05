import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as core from '../core.js';

// Run the production adapter with a simulated ST server; no credentials or paid requests.
const source = (await readFile(new URL('../index.js', import.meta.url), 'utf8'))
  .replace(/import\s*\{([\s\S]*?)\}\s*from '\.\/core\.js';/, 'const {$1} = core;');

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function createRuntime({ generateFailure = false, tokenError = false, imageResponse = PNG } = {}) {
  const calls = [];
  const secrets = [
    { id: 'original', active: true, value: 'masked-original' },
    { id: 'plugin', active: false, value: 'masked-plugin' }
  ];
  let panel;
  const elements = new Map();
  const scopes = [];
  const target = { append(value) { panel = value; } };
  const settingsContext = {
    extensionSettings: {
      [core.EXTENSION_ID]: {
        provider: 'novelai', secretIds: { novelai: 'plugin' },
        sampler: 'euler', scheduler: 'normal', novelai: { seed: 0 }
      }
    },
    saveSettingsDebounced() {},
    getRequestHeaders() { return { 'Content-Type': 'application/json' }; }
  };
  function element(selector) {
    if (!elements.has(selector)) elements.set(selector, { value: '', dataset: {}, hidden: false, addEventListener() {} });
    return elements.get(selector);
  }
  const document = {
    readyState: 'loading', addEventListener() {},
    getElementById(id) { return id === 'extensions_settings' ? target : id === 'minigame-image-api-settings' ? panel : null; },
    querySelector(selector) { return element(selector); },
    querySelectorAll() { return []; },
    createElement() {
      return {
        set innerHTML(html) {
          this.html = html;
          for (const match of html.matchAll(/<input\b[^>]*name="([^"]+)"[^>]*>/g)) {
            element(`[name="${match[1]}"]`).value = /value="([^"]*)"/.exec(match[0])?.[1] || '';
          }
          for (const match of html.matchAll(/<select\b[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
            const selected = /<option\b([^>]*\bselected[^>]*)>([^<]*)<\/option>/.exec(match[2]);
            element(`[name="${match[1]}"]`).value = selected ? /value="([^"]*)"/.exec(selected[1])?.[1] || selected[2] : '';
          }
          for (const match of html.matchAll(/data-provider-scope="([^"]+)"/g)) {
            scopes.push({ dataset: { providerScope: match[1] }, hidden: false });
          }
        },
        querySelector: element,
        querySelectorAll(selector) { return selector === '[data-provider-scope]' ? scopes : []; },
        addEventListener() {}
      };
    }
  };
  const runtime = vm.createContext({
    core, document, SillyTavern: { getContext: () => settingsContext },
    console: { info() {}, warn() {}, error() {} },
    URL, setTimeout, location: { href: 'http://localhost:8000/' },
    CustomEvent: class {}, dispatchEvent() {},
    async fetch(path, init) {
      const body = init.body ? JSON.parse(init.body) : null;
      calls.push({ path, body });
      if (path === '/api/secrets/read') return Response.json({ api_key_novel: secrets });
      if (path === '/api/secrets/rotate') {
        assert.equal(body.key, 'api_key_novel');
        for (const secret of secrets) secret.active = secret.id === body.id;
        return Response.json({});
      }
      if (path === '/api/novelai/status') {
        assert.equal(secrets.find((item) => item.active).id, 'plugin');
        return Response.json(tokenError ? { error: true } : { tier: 3 });
      }
      if (path === '/api/novelai/generate-image') {
        assert.equal(secrets.find((item) => item.active).id, 'plugin');
        return generateFailure ? new Response('Internal Server Error', { status: 500 }) : new Response(imageResponse);
      }
      if (path === '/api/images/upload') return Response.json({ path: '/user/images/test/portrait.png' });
      throw new Error(`Unexpected request: ${path}`);
    }
  });
  vm.runInContext(`${source}\nglobalThis.adapter = { init, generate, testConnection, readForm, applyFormSettings };`, runtime);
  return { api: runtime.adapter, calls, secrets, settingsContext, elements, scopes, get panel() { return panel; } };
}

test('NovelAI UI exposes dedicated controls and saves them without changing local defaults', async () => {
  const runtime = createRuntime();
  await runtime.api.init();
  assert.match(runtime.panel.html, /NovelAI \/ NAI Diffusion/);
  assert.match(runtime.panel.html, /验证 Token/);
  assert.ok(runtime.scopes.filter((item) => item.dataset.providerScope === 'novelai').every((item) => !item.hidden));
  assert.ok(runtime.scopes.find((item) => item.dataset.providerScope === 'bfl a1111 comfyui').hidden);
  runtime.elements.get('[name="novelai-width"]').value = '832';
  runtime.elements.get('[name="novelai-height"]').value = '1216';
  const form = runtime.api.readForm();
  assert.equal(form.seed, 0);
  assert.equal(form.sampler, 'k_euler_ancestral');
  assert.equal(form.aspectRatio, undefined);
  runtime.api.applyFormSettings();
  const settings = runtime.settingsContext.extensionSettings[core.EXTENSION_ID];
  assert.equal(settings.novelai.width, 832);
  assert.equal(settings.novelai.height, 1216);
  assert.equal(settings.novelai.seed, 0);
  assert.equal(settings.sampler, 'euler');
  assert.equal(settings.scheduler, 'normal');
});

test('NovelAI generation uses the plugin secret, converts PNG base64 and uploads normally', async () => {
  const runtime = createRuntime();
  await runtime.api.init();
  const result = await runtime.api.generate({ prompt: 'flower', negativePrompt: 'text', saveToSillyTavern: true });
  assert.equal(result.provider, 'novelai');
  assert.equal(result.images[0].dataUrl, `data:image/png;base64,${PNG}`);
  assert.equal(result.images[0].url, 'http://localhost:8000/user/images/test/portrait.png');
  const request = runtime.calls.find((call) => call.path === '/api/novelai/generate-image').body;
  assert.equal(request.negative_prompt, 'text');
  assert.equal(request.seed, 0);
  assert.equal(request.sampler, 'k_euler_ancestral');
  assert.equal(runtime.secrets.find((item) => item.active).id, 'original');
});

test('NovelAI generation failure restores the original secret', async () => {
  const runtime = createRuntime({ generateFailure: true });
  await runtime.api.init();
  await assert.rejects(runtime.api.generate({ prompt: 'flower' }), /HTTP 500/);
  assert.equal(runtime.secrets.find((item) => item.active).id, 'original');
});

test('NovelAI rejects an HTTP 200 text response and does not upload it or report success', async () => {
  const runtime = createRuntime({ imageResponse: '{"output":"a story"}' });
  await runtime.api.init();
  await assert.rejects(runtime.api.generate({ prompt: 'flower', saveToSillyTavern: true }), /未返回有效 PNG/);
  assert.equal(runtime.secrets.find((item) => item.active).id, 'original');
  assert.ok(!runtime.calls.some((call) => call.path === '/api/images/upload'));
});

test('NovelAI concurrent calls serialize secret rotation and restore the original secret', async () => {
  const runtime = createRuntime();
  await runtime.api.init();
  await Promise.all([runtime.api.generate({ prompt: 'one' }), runtime.api.generate({ prompt: 'two' })]);
  assert.deepEqual(runtime.calls.filter((call) => call.path === '/api/secrets/rotate').map((call) => call.body.id),
    ['plugin', 'original', 'plugin', 'original']);
});

test('NovelAI token verification checks subscription without generating a paid image', async () => {
  const runtime = createRuntime();
  await runtime.api.init();
  const status = await runtime.api.testConnection('novelai');
  assert.equal(status.ready, true);
  assert.ok(runtime.calls.some((call) => call.path === '/api/novelai/status'));
  assert.ok(!runtime.calls.some((call) => call.path === '/api/novelai/generate-image'));
  assert.equal(runtime.secrets.find((item) => item.active).id, 'original');
});

test('NovelAI token failure is reported and restores the original secret', async () => {
  const runtime = createRuntime({ tokenError: true });
  await runtime.api.init();
  await assert.rejects(runtime.api.testConnection('novelai'), /Token 验证失败/);
  assert.equal(runtime.secrets.find((item) => item.active).id, 'original');
});
