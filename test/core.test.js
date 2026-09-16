import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_MODEL,
  buildGeminiRequest,
  extractGeminiImages,
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
  assert.equal(settings.model, DEFAULT_MODEL);
  assert.equal(settings.secretId, 'secret-1');
  assert.equal(Object.hasOwn(settings, 'apiKey'), false);
});

test('derives supported ratio and size from code-controlled dimensions', () => {
  assert.equal(normalizeAspectRatio('', 1600, 900), '16:9');
  assert.equal(normalizeAspectRatio('1:1', 1600, 900), '1:1');
  assert.equal(normalizeImageSize('', 1024, 1024), '1K');
  assert.equal(normalizeImageSize('', 2048, 1024), '2K');
  assert.equal(normalizeImageSize('', 4096, 4096), '4K');
});

test('builds a Gemini image request with caller overrides', () => {
  const body = buildGeminiRequest({ secretId: 'secret-1', model: DEFAULT_MODEL }, {
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
