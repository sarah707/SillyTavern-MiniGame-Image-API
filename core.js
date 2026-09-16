export const EXTENSION_ID = 'minigame-image-api';
export const API_VERSION = 2;
export const DEFAULT_MODEL = 'gemini-3.1-flash-image';

export const PROVIDERS = Object.freeze({
  gemini: {
    label: 'Gemini AI Studio',
    credentialLabel: 'Gemini API Key',
    secretKey: 'api_key_makersuite',
    credentialType: 'password',
    models: [
      { id: 'gemini-3.1-flash-image', label: 'Gemini 3.1 Flash Image' },
      { id: 'gemini-3-pro-image', label: 'Gemini 3 Pro Image' },
      { id: 'gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image' }
    ]
  },
  vertex: {
    label: 'Google Vertex AI（服务账号 JSON）',
    credentialLabel: 'Vertex 服务账号 JSON',
    secretKey: 'vertexai_service_account_json',
    credentialType: 'textarea',
    models: [
      { id: 'gemini-3.1-flash-image', label: 'Gemini 3.1 Flash Image' },
      { id: 'gemini-3-pro-image', label: 'Gemini 3 Pro Image' },
      { id: 'gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image' }
    ]
  },
  openai: {
    label: 'OpenAI Images',
    credentialLabel: 'OpenAI API Key',
    secretKey: 'api_key_openai',
    credentialType: 'password',
    models: [
      { id: 'gpt-image-2.5-sunburst', label: 'GPT Image 2.5 Sunburst' },
      { id: 'gpt-image-2.5-flare', label: 'GPT Image 2.5 Flare' },
      { id: 'gpt-image-2', label: 'GPT Image 2' },
      { id: 'gpt-image-1.5', label: 'GPT Image 1.5' },
      { id: 'gpt-image-1-mini', label: 'GPT Image 1 Mini' }
    ]
  },
  stability: {
    label: 'Stability AI',
    credentialLabel: 'Stability API Key',
    secretKey: 'api_key_stability',
    credentialType: 'password',
    models: [
      { id: 'stable-image-ultra', label: 'Stable Image Ultra' },
      { id: 'stable-image-core', label: 'Stable Image Core' },
      { id: 'stable-diffusion-3', label: 'Stable Diffusion 3 / 3.5' }
    ]
  },
  bfl: {
    label: 'Black Forest Labs / FLUX',
    credentialLabel: 'BFL API Key',
    secretKey: 'api_key_bfl',
    credentialType: 'password',
    models: [
      { id: 'flux-pro-1.1-ultra', label: 'FLUX 1.1 Pro Ultra' },
      { id: 'flux-pro-1.1', label: 'FLUX 1.1 Pro' },
      { id: 'flux-pro', label: 'FLUX Pro' }
    ]
  },
  a1111: {
    label: 'Stable Diffusion WebUI / Forge',
    credentialLabel: '',
    secretKey: '',
    credentialType: 'none',
    models: []
  },
  comfyui: {
    label: 'ComfyUI',
    credentialLabel: '',
    secretKey: '',
    credentialType: 'none',
    models: []
  }
});

export const GEMINI_IMAGE_MODELS = PROVIDERS.gemini.models;
export const GEMINI_SECRET_KEY = PROVIDERS.gemini.secretKey;

export const ASPECT_RATIOS = Object.freeze([
  '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'
]);

export const IMAGE_SIZES = Object.freeze(['1K', '2K', '4K']);

const DEFAULT_MODELS = Object.freeze(Object.fromEntries(
  Object.entries(PROVIDERS).map(([id, provider]) => [id, provider.models[0]?.id || ''])
));

export const DEFAULT_SETTINGS = Object.freeze({
  provider: 'gemini',
  models: DEFAULT_MODELS,
  aspectRatio: '1:1',
  imageSize: '1K',
  secretIds: {},
  secretLabels: {},
  vertexLocation: 'global',
  apiUrls: {
    a1111: 'http://127.0.0.1:7860',
    comfyui: 'http://127.0.0.1:8188'
  },
  a1111Auth: '',
  comfyWorkflowJson: '',
  sampler: 'euler',
  scheduler: 'normal',
  steps: 28,
  cfgScale: 7,
  seed: -1,
  lastTestedAt: ''
});

function toRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeUrl(value, fallback) {
  return String(value || fallback || '').trim().replace(/\/+$/, '');
}

export function normalizeSettings(value = {}) {
  const source = toRecord(value);
  const provider = Object.hasOwn(PROVIDERS, source.provider) ? source.provider : DEFAULT_SETTINGS.provider;
  const sourceModels = toRecord(source.models);
  const models = { ...DEFAULT_MODELS };
  for (const id of Object.keys(PROVIDERS)) {
    models[id] = String(sourceModels[id] || (id === 'gemini' ? source.model : '') || models[id]).trim();
  }
  const secretIds = { ...toRecord(source.secretIds) };
  const secretLabels = { ...toRecord(source.secretLabels) };
  if (source.secretId && !secretIds.gemini) secretIds.gemini = String(source.secretId);
  if (source.secretLabel && !secretLabels.gemini) secretLabels.gemini = String(source.secretLabel);
  return {
    provider,
    models,
    aspectRatio: normalizeAspectRatio(source.aspectRatio),
    imageSize: normalizeImageSize(source.imageSize),
    secretIds: Object.fromEntries(Object.entries(secretIds).map(([key, item]) => [key, String(item || '').trim()])),
    secretLabels: Object.fromEntries(Object.entries(secretLabels).map(([key, item]) => [key, String(item || '').trim()])),
    vertexLocation: String(source.vertexLocation || DEFAULT_SETTINGS.vertexLocation).trim() || DEFAULT_SETTINGS.vertexLocation,
    apiUrls: {
      a1111: normalizeUrl(source.apiUrls?.a1111, DEFAULT_SETTINGS.apiUrls.a1111),
      comfyui: normalizeUrl(source.apiUrls?.comfyui, DEFAULT_SETTINGS.apiUrls.comfyui)
    },
    a1111Auth: String(source.a1111Auth || '').trim(),
    comfyWorkflowJson: String(source.comfyWorkflowJson || '').trim(),
    sampler: String(source.sampler || DEFAULT_SETTINGS.sampler).trim(),
    scheduler: String(source.scheduler || DEFAULT_SETTINGS.scheduler).trim(),
    steps: Math.min(150, Math.max(1, Number(source.steps) || DEFAULT_SETTINGS.steps)),
    cfgScale: Math.min(30, Math.max(0, Number(source.cfgScale) || DEFAULT_SETTINGS.cfgScale)),
    seed: Number.isFinite(Number(source.seed)) ? Number(source.seed) : -1,
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

export function getDimensions(request = {}, settings = DEFAULT_SETTINGS) {
  const explicitWidth = Number(request.width);
  const explicitHeight = Number(request.height);
  if (explicitWidth > 0 && explicitHeight > 0) {
    return {
      width: Math.max(64, Math.round(explicitWidth / 64) * 64),
      height: Math.max(64, Math.round(explicitHeight / 64) * 64)
    };
  }
  const ratio = normalizeAspectRatio(request.aspectRatio || settings.aspectRatio);
  const [ratioWidth, ratioHeight] = ratio.split(':').map(Number);
  const edge = { '1K': 1024, '2K': 2048, '4K': 4096 }[
    normalizeImageSize(request.imageSize || request.size || settings.imageSize)
  ] || 1024;
  const scale = edge / Math.max(ratioWidth, ratioHeight);
  return {
    width: Math.max(64, Math.round((ratioWidth * scale) / 64) * 64),
    height: Math.max(64, Math.round((ratioHeight * scale) / 64) * 64)
  };
}

export function buildGeminiRequest(settings, request = {}, provider = 'gemini') {
  const prompt = String(request.prompt || '').trim();
  if (!prompt) throw new Error('生图提示词不能为空。');
  const negativePrompt = String(request.negativePrompt || '').trim();
  const content = negativePrompt ? `${prompt}\n\nAvoid the following elements: ${negativePrompt}` : prompt;
  const model = String(request.model || settings.models?.[provider] || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const body = {
    chat_completion_source: provider === 'vertex' ? 'vertexai' : 'makersuite',
    secret_id: settings.secretIds?.[provider],
    model,
    messages: [{ role: 'user', content }],
    stream: false,
    request_images: true,
    request_image_aspect_ratio: normalizeAspectRatio(request.aspectRatio || settings.aspectRatio, request.width, request.height),
    request_image_resolution: normalizeImageSize(request.imageSize || request.size || settings.imageSize, request.width, request.height),
    max_tokens: 8192,
    temperature: 1,
    top_p: 0.95,
    top_k: 40,
    stop: [],
    use_sysprompt: false,
    include_reasoning: false
  };
  if (provider === 'vertex') {
    body.vertexai_auth_mode = 'full';
    body.vertexai_region = String(request.location || settings.vertexLocation || 'global');
  }
  return body;
}

export function buildOpenAIRequest(settings, request = {}) {
  const prompt = String(request.prompt || '').trim();
  if (!prompt) throw new Error('生图提示词不能为空。');
  const model = String(request.model || settings.models?.openai || PROVIDERS.openai.models[0].id);
  const ratio = normalizeAspectRatio(request.aspectRatio || settings.aspectRatio, request.width, request.height);
  const [width, height] = ratio.split(':').map(Number);
  const size = width === height ? '1024x1024' : width > height ? '1536x1024' : '1024x1536';
  return {
    prompt,
    model,
    size,
    n: 1,
    quality: String(request.quality || 'medium'),
    response_format: /^dall-e/.test(model) ? 'b64_json' : undefined,
    moderation: /^gpt-image/.test(model) ? 'low' : undefined
  };
}

export function buildA1111Request(settings, request = {}) {
  const prompt = String(request.prompt || '').trim();
  if (!prompt) throw new Error('生图提示词不能为空。');
  const { width, height } = getDimensions(request, settings);
  const model = String(request.model || settings.models?.a1111 || '').trim();
  const sampler = String(request.sampler || settings.sampler || 'Euler');
  return {
    url: String(request.apiUrl || settings.apiUrls?.a1111 || DEFAULT_SETTINGS.apiUrls.a1111),
    auth: String(request.auth ?? settings.a1111Auth ?? ''),
    prompt,
    negative_prompt: String(request.negativePrompt || ''),
    width,
    height,
    steps: Number(request.steps || settings.steps || 28),
    cfg_scale: Number(request.cfgScale || settings.cfgScale || 7),
    sampler_name: sampler.toLowerCase() === 'euler' ? 'Euler' : sampler,
    seed: Number.isFinite(Number(request.seed)) ? Number(request.seed) : Number(settings.seed ?? -1),
    batch_size: 1,
    n_iter: 1,
    override_settings: model ? { sd_model_checkpoint: model } : undefined,
    override_settings_restore_afterwards: Boolean(model)
  };
}

export function makeDefaultComfyWorkflow(settings, request = {}) {
  const { width, height } = getDimensions(request, settings);
  const model = String(request.model || settings.models?.comfyui || '').trim();
  if (!model) throw new Error('请先选择 ComfyUI checkpoint，或填写自定义 API 工作流。');
  const seed = Number(request.seed ?? settings.seed);
  return {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: model } },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: '{{prompt}}', clip: ['1', 1] } },
    '3': { class_type: 'CLIPTextEncode', inputs: { text: '{{negative_prompt}}', clip: ['1', 1] } },
    '4': { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
    '5': {
      class_type: 'KSampler',
      inputs: {
        seed: seed >= 0 ? seed : Math.floor(Math.random() * 2147483647),
        steps: Number(request.steps || settings.steps || 28),
        cfg: Number(request.cfgScale || settings.cfgScale || 7),
        sampler_name: String(request.sampler || settings.sampler || 'euler'),
        scheduler: String(request.scheduler || settings.scheduler || 'normal'),
        denoise: 1,
        model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['4', 0]
      }
    },
    '6': { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
    '7': { class_type: 'SaveImage', inputs: { filename_prefix: 'MiniGameImageAPI', images: ['6', 0] } }
  };
}

function replaceWorkflowValue(value, replacements) {
  if (Array.isArray(value)) return value.map((item) => replaceWorkflowValue(item, replacements));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceWorkflowValue(item, replacements)]));
  }
  if (typeof value !== 'string') return value;
  if (Object.hasOwn(replacements, value)) return replacements[value];
  let result = value;
  for (const [token, replacement] of Object.entries(replacements)) {
    result = result.replaceAll(token, String(replacement));
  }
  return result;
}

export function buildComfyPrompt(settings, request = {}) {
  let workflow;
  const raw = String(request.workflowJson || settings.comfyWorkflowJson || '').trim();
  try {
    workflow = raw ? JSON.parse(raw) : makeDefaultComfyWorkflow(settings, request);
  } catch (error) {
    throw new Error(`ComfyUI 工作流 JSON 无效：${error.message}`);
  }
  const { width, height } = getDimensions(request, settings);
  const seed = Number(request.seed ?? settings.seed);
  const replacements = {
    '{{prompt}}': String(request.prompt || ''),
    '{{negative_prompt}}': String(request.negativePrompt || ''),
    '{{width}}': width,
    '{{height}}': height,
    '{{seed}}': seed >= 0 ? seed : Math.floor(Math.random() * 2147483647),
    '{{model}}': String(request.model || settings.models?.comfyui || ''),
    '{{sampler}}': String(request.sampler || settings.sampler || 'euler'),
    '{{scheduler}}': String(request.scheduler || settings.scheduler || 'normal'),
    '{{steps}}': Number(request.steps || settings.steps || 28),
    '{{cfg}}': Number(request.cfgScale || settings.cfgScale || 7)
  };
  return JSON.stringify({ prompt: replaceWorkflowValue(workflow, replacements) });
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

export function makeImage(mimeType, data) {
  const normalizedMimeType = String(mimeType || 'image/png').toLowerCase();
  const normalizedData = String(data || '').replace(/^data:[^;,]+;base64,/, '');
  if (!normalizedData) return null;
  return { mimeType: normalizedMimeType, data: normalizedData, dataUrl: `data:${normalizedMimeType};base64,${normalizedData}` };
}

export function sanitizeFileName(value) {
  return String(value || `minigame-image-${Date.now()}`)
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || `minigame-image-${Date.now()}`;
}
