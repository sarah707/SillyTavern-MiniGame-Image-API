import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_MODEL,
  buildA1111Request,
  buildComfyPrompt,
  buildGeminiRequest,
  buildOpenAIRequest,
  extractGeminiImages,
  getDimensions,
  normalizeAspectRatio,
  normalizeImageSize,
  normalizeSettings
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
