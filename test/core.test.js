import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_MODEL,
  DEFAULT_NEGATIVE_PROMPTS,
  buildA1111Request,
  buildComfyPrompt,
  buildGeminiRequest,
  buildOpenAIRequest,
  buildNovelAIRequest,
  extractGeminiImages,
  extractNovelAIImage,
  getDimensions,
  normalizeAspectRatio,
  normalizeImageSize,
  normalizeSettings,
  resolveNegativePrompt
} from '../core.js';

test('normalizes settings without persisting an API key', () => {
  const settings = normalizeSettings({
    provider: 'unknown',
    model: '',
    apiKey: 'must-not-survive',
    secretId: 'secret-1'
  });
  assert.equal(settings.provider, 'gemini');
  assert.equal(settings.models.gemini, DEFAULT_MODEL);
  assert.equal(settings.secretIds.gemini, 'secret-1');
  assert.equal(Object.hasOwn(settings, 'apiKey'), false);
  assert.equal(Object.hasOwn(settings, 'serviceAccountJson'), false);
});

test('NovelAI defaults are independent of local sampler settings and omit plaintext tokens', () => {
  const settings = normalizeSettings({ provider: 'novelai', sampler: 'euler', scheduler: 'normal', novelai: { token: 'private' } });
  assert.equal(settings.provider, 'novelai');
  assert.equal(settings.models.novelai, 'nai-diffusion-4-5-full');
  assert.equal(settings.novelai.sampler, 'k_euler_ancestral');
  assert.equal(settings.novelai.scheduler, 'karras');
  assert.equal(Object.hasOwn(settings.novelai, 'token'), false);
  const body = buildNovelAIRequest(settings, { prompt: 'portrait' });
  assert.equal(body.width, 1024);
  assert.equal(body.height, 1024);
  assert.equal(body.scale, 5);
  assert.equal(body.steps, 28);
  assert.equal(body.seed, -1);
  assert.equal(body.upscale_ratio, 1);
  assert.equal(Object.hasOwn(body, 'secret_id'), false);
});

test('NovelAI maps API overrides to the SillyTavern route and preserves zero CFG and seed', () => {
  const settings = normalizeSettings({ novelai: { width: 832, height: 1216, seed: 123 } });
  const body = buildNovelAIRequest(settings, {
    prompt: ' portrait ', negativePrompt: 'letters', model: 'nai-diffusion-3',
    width: 513, height: 769, aspectRatio: '16:9', imageSize: '2K',
    steps: 100, cfgScale: 0, seed: 0, sampler: 'k_dpmpp_2m', scheduler: 'native'
  });
  assert.equal(body.prompt, 'portrait');
  assert.equal(body.negative_prompt, 'letters');
  assert.equal(body.model, 'nai-diffusion-3');
  assert.equal(body.width, 512);
  assert.equal(body.height, 768);
  assert.equal(body.steps, 50);
  assert.equal(body.scale, 0);
  assert.equal(body.seed, 0);
  assert.equal(body.sampler, 'k_dpmpp_2m');
  assert.equal(body.scheduler, 'native');
});

test('NovelAI uses its saved dimensions and supports caller ratio/size dimensions', () => {
  const settings = normalizeSettings({ novelai: { width: 832, height: 1216 } });
  const saved = buildNovelAIRequest(settings, { prompt: 'portrait' });
  assert.equal(saved.width, 832);
  assert.equal(saved.height, 1216);
  const inferred = buildNovelAIRequest(settings, { prompt: 'portrait', aspectRatio: '16:9', imageSize: '1K' });
  assert.equal(inferred.width, 1024);
  assert.equal(inferred.height, 576);
});

test('NovelAI rejects empty prompts and incompatible sampler names before any request', () => {
  const settings = normalizeSettings();
  assert.throws(() => buildNovelAIRequest(settings, { prompt: ' ' }), /不能为空/);
  assert.throws(() => buildNovelAIRequest(settings, { prompt: 'flower', sampler: 'euler' }), /不支持采样器/);
  assert.throws(() => buildNovelAIRequest(settings, { prompt: 'flower', scheduler: 'normal' }), /不支持噪声调度/);
  assert.throws(() => buildNovelAIRequest(settings, { prompt: 'flower', model: 'erato' }), /文字模型/);
});

test('negative prompt settings initialize NAI avatars, preserve cleared fields and keep modes independent', () => {
  const defaults = normalizeSettings();
  assert.equal(defaults.negativePrompts.novelai, DEFAULT_NEGATIVE_PROMPTS.novelai);
  assert.equal(defaults.negativePrompts.a1111, '');
  const saved = normalizeSettings({ negativePrompts: { novelai: '', a1111: '中文, bad hands', stability: 'grain', comfyui: 'blur', gemini: 'ignored' } });
  assert.deepEqual(saved.negativePrompts, { novelai: '', stability: 'grain', a1111: '中文, bad hands', comfyui: 'blur' });
  assert.deepEqual(normalizeSettings(JSON.parse(JSON.stringify(saved))).negativePrompts, saved.negativePrompts);
});

test('configured negative prompts merge with caller exclusions without language filtering or altered emphasis', () => {
  const settings = normalizeSettings({ negativePrompts: { novelai: '{bad anatomy}, 中文', a1111: '' } });
  assert.equal(resolveNegativePrompt(settings, 'novelai', 'watermark'), '{bad anatomy}, 中文, watermark');
  assert.equal(resolveNegativePrompt(settings, 'novelai', '{bad anatomy}, 中文'), '{bad anatomy}, 中文');
  assert.equal(resolveNegativePrompt(settings, 'a1111', '文字'), '文字');
  for (const provider of ['gemini', 'vertex', 'openai', 'bfl']) {
    assert.equal(resolveNegativePrompt(settings, provider, 'caller exclusions'), 'caller exclusions');
    assert.equal(resolveNegativePrompt(settings, provider), '');
  }
});

test('NovelAI image parser accepts a real PNG and rejects text, HTML, JSON and incomplete bytes', () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  assert.equal(extractNovelAIImage(png).dataUrl, `data:image/png;base64,${png}`);
  for (const value of ['', 'This is a story.', '<html>Not Found</html>', '{"error":true}', 'UE5H',
    Buffer.from('This is a story.').toString('base64'), png.slice(0, -16)]) {
    assert.throws(() => extractNovelAIImage(value), /未返回有效 PNG/);
  }
});

test('derives supported ratio and size from code-controlled dimensions', () => {
  assert.equal(normalizeAspectRatio('', 1600, 900), '16:9');
  assert.equal(normalizeAspectRatio('1:1', 1600, 900), '1:1');
  assert.equal(normalizeImageSize('', 1024, 1024), '1K');
  assert.equal(normalizeImageSize('', 2048, 1024), '2K');
  assert.equal(normalizeImageSize('', 4096, 4096), '4K');
});

test('builds a Gemini image request with caller overrides', () => {
  const settings = normalizeSettings({
    secretIds: { gemini: 'secret-1' },
    models: { gemini: DEFAULT_MODEL }
  });
  const body = buildGeminiRequest(settings, {
    prompt: 'portrait',
    negativePrompt: 'text, watermark',
    model: 'gemini-3-pro-image',
    aspectRatio: '3:4',
    imageSize: '2K'
  });
  assert.equal(body.secret_id, 'secret-1');
  assert.equal(body.model, 'gemini-3-pro-image');
  assert.equal(body.request_images, true);
  assert.equal(body.request_image_aspect_ratio, '3:4');
  assert.equal(body.request_image_resolution, '2K');
  assert.match(body.messages[0].content, /watermark/);
});

test('builds a Vertex image request with the service-account secret and region', () => {
  const settings = normalizeSettings({
    secretIds: { vertex: 'vertex-secret' },
    vertexLocation: 'us-central1'
  });
  const body = buildGeminiRequest(settings, { prompt: 'portrait' }, 'vertex');
  assert.equal(body.chat_completion_source, 'vertexai');
  assert.equal(body.secret_id, 'vertex-secret');
  assert.equal(body.vertexai_auth_mode, 'full');
  assert.equal(body.vertexai_region, 'us-central1');
});

test('maps OpenAI image requests to supported size buckets', () => {
  const settings = normalizeSettings({ models: { openai: 'gpt-image-1.5' } });
  const body = buildOpenAIRequest(settings, { prompt: 'portrait', aspectRatio: '9:16' });
  assert.equal(body.model, 'gpt-image-1.5');
  assert.equal(body.size, '1024x1536');
  assert.equal(body.quality, 'medium');
});

test('builds Stable Diffusion WebUI payload with dimensions and checkpoint override', () => {
  const settings = normalizeSettings({
    models: { a1111: 'local-model.safetensors' },
    apiUrls: { a1111: 'http://127.0.0.1:7860' }
  });
  const body = buildA1111Request(settings, {
    prompt: 'portrait',
    negativePrompt: 'text',
    width: 513,
    height: 769
  });
  assert.equal(body.width, 512);
  assert.equal(body.height, 768);
  assert.equal(body.override_settings.sd_model_checkpoint, 'local-model.safetensors');
  assert.equal(body.negative_prompt, 'text');
});

test('builds a default ComfyUI API workflow and replaces custom placeholders', () => {
  const settings = normalizeSettings({
    models: { comfyui: 'checkpoint.safetensors' },
    steps: 6,
    seed: 123
  });
  const defaultPayload = JSON.parse(buildComfyPrompt(settings, {
    prompt: 'pale purple flower',
    negativePrompt: 'letters',
    width: 512,
    height: 512
  }));
  assert.equal(defaultPayload.prompt['1'].inputs.ckpt_name, 'checkpoint.safetensors');
  assert.equal(defaultPayload.prompt['2'].inputs.text, 'pale purple flower');
  assert.equal(defaultPayload.prompt['3'].inputs.text, 'letters');
  assert.equal(defaultPayload.prompt['5'].inputs.steps, 6);

  const customPayload = JSON.parse(buildComfyPrompt(settings, {
    prompt: 'custom prompt',
    workflowJson: JSON.stringify({ node: { inputs: { text: '{{prompt}}', width: '{{width}}' } } }),
    width: 640,
    height: 512
  }));
  assert.equal(customPayload.prompt.node.inputs.text, 'custom prompt');
  assert.equal(customPayload.prompt.node.inputs.width, 640);
});

test('derives local dimensions on 64-pixel boundaries', () => {
  const settings = normalizeSettings({ aspectRatio: '16:9', imageSize: '1K' });
  assert.deepEqual(getDimensions({}, settings), { width: 1024, height: 576 });
});

test('extracts inline Gemini images from the Tavern response', () => {
  const images = extractGeminiImages({
    responseContent: {
      parts: [
        { text: 'done' },
        { inlineData: { mimeType: 'image/png', data: 'UE5H' } }
      ]
    }
  });
  assert.equal(images.length, 1);
  assert.equal(images[0].mimeType, 'image/png');
  assert.equal(images[0].dataUrl, 'data:image/png;base64,UE5H');
});
