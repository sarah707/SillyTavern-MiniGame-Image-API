import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as core from '../core.js';

// Run the production adapter with a simulated ST server; no credentials or paid requests.
const source = (await readFile(new URL('../index.js', import.meta.url), 'utf8'))
  .replace(/import\s*\{([\s\S]*?)\}\s*from '\.\/core\.js';/, 'const {$1} = core;');

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function createRuntime({ generateFailure = false, tokenError = false, imageResponse = PNG, savedSettings = {} } = {}) {
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
        provider: 'novelai', secretIds: Object.fromEntries(Object.entries(core.PROVIDERS).filter(([, value]) => value.secretKey).map(([key]) => [key, 'plugin'])),
        sampler: 'euler', scheduler: 'normal', novelai: { seed: 0 },
        ...savedSettings
      }
    },
    saveSettingsDebounced() {},
    getRequestHeaders() { return { 'Content-Type': 'application/json' }; }
  };
  function element(selector) {
    if (!elements.has(selector)) {
      const handlers = new Map();
      elements.set(selector, { value: '', dataset: {}, hidden: false,
        addEventListener(type, handler) { handlers.set(type, handler); },
        dispatch(type) { return handlers.get(type)?.(); }
      });
    }
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
          for (const match of html.matchAll(/<textarea\b[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/g)) {
            element(`[name="${match[1]}"]`).value = match[2].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&');
          }
          for (const match of html.matchAll(/<select\b[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
            const selected = /<option\b([^>]*\bselected[^>]*)>([^<]*)<\/option>/.exec(match[2]);
            element(`[name="${match[1]}"]`).value = selected ? /value="([^"]*)"/.exec(selected[1])?.[1] || selected[2] : '';
          }
          for (const match of html.matchAll(/<[^>]+data-provider-scope="([^"]+)"[^>]*>/g)) {
            const negativeProvider = /data-negative-provider="([^"]+)"/.exec(match[0])?.[1];
            const scope = { dataset: { providerScope: match[1], negativeProvider }, hidden: false };
            scopes.push(scope);
            if (negativeProvider) elements.set(`[data-negative-provider="${negativeProvider}"]`, scope);
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
      if (path === '/api/secrets/read') return Response.json(Object.fromEntries(Object.values(core.PROVIDERS).filter((provider) => provider.secretKey).map((provider) => [provider.secretKey, secrets])));
      if (path === '/api/secrets/rotate') {
        assert.ok(Object.values(core.PROVIDERS).some((provider) => provider.secretKey === body.key));
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
      if (path === '/api/sd/stability/generate') return new Response(PNG);
      if (path === '/api/sd/generate') return Response.json({ images: [PNG] });
      if (path === '/api/sd/comfy/generate') return Response.json({ data: PNG, format: 'png' });
      if (path === '/api/backends/chat-completions/generate') return Response.json({ responseContent: { parts: [{ inlineData: { mimeType: 'image/png', data: PNG } }] } });
      if (path === '/api/openai/generate-image') return Response.json({ data: [{ b64_json: PNG }] });
      if (path === '/api/sd/bfl/generate') return Response.json({ image: PNG });
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
  assert.equal(request.negative_prompt, `${core.DEFAULT_NEGATIVE_PROMPTS.novelai}, text`);
  assert.equal(request.seed, 0);
  assert.equal(request.sampler, 'k_euler_ancestral');
  assert.equal(runtime.secrets.find((item) => item.active).id, 'original');
});

test('negative prompt fields show only for supported modes and save separately across switches and reloads', async () => {
  const runtime = createRuntime();
  await runtime.api.init();
  assert.equal(runtime.elements.get('[name="negativePrompt-novelai"]').value, core.DEFAULT_NEGATIVE_PROMPTS.novelai);
  const fields = runtime.scopes.filter((scope) => scope.dataset.negativeProvider);
  assert.equal(fields.length, 4);
  const select = runtime.elements.get('[name="provider"]');
  for (const provider of Object.keys(core.PROVIDERS)) {
    select.value = provider;
    select.dispatch('change');
    assert.deepEqual(fields.filter((field) => !field.hidden).map((field) => field.dataset.negativeProvider),
      Object.hasOwn(core.DEFAULT_NEGATIVE_PROMPTS, provider) ? [provider] : []);
    if (Object.hasOwn(core.DEFAULT_NEGATIVE_PROMPTS, provider)) {
      runtime.elements.get(`[name="negativePrompt-${provider}"]`).value = `${provider} exclusions, 中文`;
      runtime.api.applyFormSettings();
    } else {
      assert.equal(Object.hasOwn(runtime.api.readForm(), 'negativePrompt'), false);
    }
  }
  const saved = runtime.settingsContext.extensionSettings[core.EXTENSION_ID];
  for (const provider of Object.keys(core.DEFAULT_NEGATIVE_PROMPTS)) {
    assert.equal(saved.negativePrompts[provider], `${provider} exclusions, 中文`);
  }
  const reloaded = createRuntime({ savedSettings: saved });
  await reloaded.api.init();
  for (const provider of Object.keys(core.DEFAULT_NEGATIVE_PROMPTS)) {
    assert.equal(reloaded.elements.get(`[name="negativePrompt-${provider}"]`).value, `${provider} exclusions, 中文`);
  }
  select.value = 'novelai';
  select.dispatch('change');
  runtime.elements.get('[name="negativePrompt-novelai"]').value = '';
  runtime.api.applyFormSettings();
  const cleared = createRuntime({ savedSettings: runtime.settingsContext.extensionSettings[core.EXTENSION_ID] });
  await cleared.api.init();
  assert.equal(cleared.elements.get('[name="negativePrompt-novelai"]').value, '');
  assert.doesNotMatch(runtime.panel.html, /name="negativePrompt-(?:gemini|vertex|openai|bfl)"/);
});

test('ComfyUI hides the negative field when its custom workflow has no negative placeholder', async () => {
  const runtime = createRuntime();
  await runtime.api.init();
  const select = runtime.elements.get('[name="provider"]');
  select.value = 'comfyui';
  select.dispatch('change');
  const group = runtime.elements.get('[data-negative-provider="comfyui"]');
  const workflow = runtime.elements.get('[name="workflowJson"]');
  assert.equal(group.hidden, false);
  workflow.value = '{"1":{"inputs":{"text":"{{prompt}}"}}}';
  workflow.dispatch('input');
  assert.equal(group.hidden, true);
  workflow.value = '{"2":{"inputs":{"text":"{{negative_prompt}}"}}}';
  workflow.dispatch('input');
  assert.equal(group.hidden, false);
  workflow.value = '';
  workflow.dispatch('input');
  assert.equal(group.hidden, false);
});

for (const [provider, endpoint] of Object.entries({
  novelai: '/api/novelai/generate-image', stability: '/api/sd/stability/generate',
  a1111: '/api/sd/generate', comfyui: '/api/sd/comfy/generate'
})) {
  test(`${provider} sends saved negative text plus rolecard exclusions through the generation route`, async () => {
    const runtime = createRuntime({ savedSettings: { provider, negativePrompts: { [provider]: 'lowres, 自定义排除项' } } });
    await runtime.api.init();
    const result = await runtime.api.generate({ prompt: 'portrait', negativePrompt: 'text, watermark',
      ...(provider === 'comfyui' ? { model: 'portrait.safetensors' } : {}) });
    const body = runtime.calls.find((call) => call.path === endpoint).body;
    const actual = provider === 'stability' ? body.payload.negative_prompt
      : provider === 'comfyui' ? JSON.parse(body.prompt).prompt['3'].inputs.text : body.negative_prompt;
    assert.equal(actual, 'lowres, 自定义排除项, text, watermark');
    assert.equal(result.images[0].data, PNG);
    assert.equal(runtime.secrets.find((item) => item.active).id, 'original');
  });
}

test('modes without native negative fields never inherit the NAI portrait defaults', async () => {
  for (const provider of ['gemini', 'vertex', 'openai', 'bfl']) {
    const runtime = createRuntime({ savedSettings: { provider } });
    await runtime.api.init();
    await runtime.api.generate({ prompt: 'portrait' });
    const generated = runtime.calls.find((call) => call.path.includes('generate'));
    assert.equal(generated.body.messages?.[0]?.content ?? generated.body.prompt, 'portrait');
    assert.equal(generated.body.negative_prompt, undefined);
  }
});

test('NovelAI passes prompts of any language to the image endpoint without text model calls', async () => {
  const runtime = createRuntime();
  runtime.settingsContext.ChatCompletionService = { sendRequest() { throw new Error('Must not call a text model'); } };
  await runtime.api.init();
  for (const prompt of ['1boy, silver hair, blue eyes, watercolor, no text', '中文头像，银发蓝眼', '中文头像, silver hair', '銀髪の人物', 'portrait 🙂']) {
    runtime.calls.length = 0;
    const result = await runtime.api.generate({ prompt, negativePrompt: '文字, watermark, 低质量' });
    const requests = runtime.calls.filter((call) => call.path === '/api/novelai/generate-image');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].body.prompt, prompt);
    assert.equal(requests[0].body.negative_prompt, `${core.DEFAULT_NEGATIVE_PROMPTS.novelai}, 文字, watermark, 低质量`);
    assert.equal(result.images[0].data, PNG);
    assert.equal(runtime.secrets.find((item) => item.active).id, 'original');
  }
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
