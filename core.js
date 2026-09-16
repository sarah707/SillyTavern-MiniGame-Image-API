export const EXTENSION_ID = 'minigame-image-api';
export const API_VERSION = 1;
export const DEFAULT_MODEL = 'gemini-3.1-flash-image';
export const GEMINI_SECRET_KEY = 'api_key_makersuite';

export const GEMINI_IMAGE_MODELS = Object.freeze([
  { id: 'gemini-3.1-flash-image', label: 'Gemini 3.1 Flash Image' },
  { id: 'gemini-3-pro-image', label: 'Gemini 3 Pro Image' },
  { id: 'gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image' }
]);

export const ASPECT_RATIOS = Object.freeze([
  '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'
]);

export const IMAGE_SIZES = Object.freeze(['1K', '2K', '4K']);

export const DEFAULT_SETTINGS = Object.freeze({
  provider: 'gemini',
  model: DEFAULT_MODEL,
  aspectRatio: '1:1',
  imageSize: '1K',
  secretId: '',
  secretLabel: '',
  lastTestedAt: ''
});

export function normalizeSettings(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    provider: source.provider === 'gemini' ? 'gemini' : DEFAULT_SETTINGS.provider,
    model: String(source.model || DEFAULT_SETTINGS.model).trim() || DEFAULT_SETTINGS.model,
    aspectRatio: normalizeAspectRatio(source.aspectRatio),
    imageSize: normalizeImageSize(source.imageSize),
    secretId: String(source.secretId || '').trim(),
    secretLabel: String(source.secretLabel || '').trim(),
    lastTestedAt: String(source.lastTestedAt || '').trim()
  };
}

export function normalizeAspectRatio(value, width, height) {
  const explicit = String(value || '').trim();
  if (ASPECT_RATIOS.includes(explicit)) return explicit;
  const numericWidth = Number(width);
  const numericHeight = Number(height);
  if (!(numericWidth > 0 && numericHeight > 0)) return DEFAULT_SETTINGS.aspectRatio;
  const target = numericWidth / numericHeight;
  return ASPECT_RATIOS.reduce((best, ratio) => {
    const [ratioWidth, ratioHeight] = ratio.split(':').map(Number);
    const [bestWidth, bestHeight] = best.split(':').map(Number);
    return Math.abs(ratioWidth / ratioHeight - target) < Math.abs(bestWidth / bestHeight - target)
      ? ratio
      : best;
  }, DEFAULT_SETTINGS.aspectRatio);
}

export function normalizeImageSize(value, width, height) {
  const explicit = String(value || '').trim().toUpperCase();
  if (IMAGE_SIZES.includes(explicit)) return explicit;
  const longestEdge = Math.max(Number(width) || 0, Number(height) || 0);
  if (longestEdge >= 3072) return '4K';
  if (longestEdge >= 1536) return '2K';
  return DEFAULT_SETTINGS.imageSize;
}

export function buildGeminiRequest(settings, request = {}) {
  const prompt = String(request.prompt || '').trim();
  if (!prompt) throw new Error('生图提示词不能为空。');
  const negativePrompt = String(request.negativePrompt || '').trim();
  const content = negativePrompt
    ? `${prompt}\n\nAvoid the following elements: ${negativePrompt}`
    : prompt;
  const model = String(request.model || settings.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const aspectRatio = normalizeAspectRatio(request.aspectRatio, request.width, request.height);
  const imageSize = normalizeImageSize(request.imageSize || request.size, request.width, request.height);
  return {
    chat_completion_source: 'makersuite',
    secret_id: settings.secretId,
    model,
    messages: [{ role: 'user', content }],
    stream: false,
    request_images: true,
    request_image_aspect_ratio: aspectRatio,
    request_image_resolution: imageSize,
    max_tokens: 8192,
    temperature: 1,
    top_p: 0.95,
    top_k: 40,
    stop: [],
    use_sysprompt: false,
    include_reasoning: false
  };
}

export function extractGeminiImages(response) {
  const parts = response?.responseContent?.parts;
  if (!Array.isArray(parts)) return [];
  return parts.flatMap((part) => {
    const inline = part?.inlineData || part?.inline_data;
    const data = String(inline?.data || '').trim();
    if (!data) return [];
    const mimeType = String(inline?.mimeType || inline?.mime_type || 'image/png').toLowerCase();
    return [{ mimeType, data, dataUrl: `data:${mimeType};base64,${data}` }];
  });
}

export function sanitizeFileName(value) {
  return String(value || `minigame-image-${Date.now()}`)
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || `minigame-image-${Date.now()}`;
}
