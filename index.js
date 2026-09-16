import {
  API_VERSION,
  ASPECT_RATIOS,
  DEFAULT_SETTINGS,
  EXTENSION_ID,
  IMAGE_SIZES,
  PROVIDERS,
  buildA1111Request,
  buildComfyPrompt,
  buildGeminiRequest,
  buildOpenAIRequest,
  extractGeminiImages,
  getDimensions,
  makeImage,
  normalizeAspectRatio,
  normalizeImageSize,
  normalizeSettings,
  sanitizeFileName
} from './core.js';

const DISPLAY_NAME = '小游戏轻度生图插件';
const SECRET_LABEL_PREFIX = DISPLAY_NAME;
const REPOSITORY_URL = 'https://github.com/sarah707/SillyTavern-MiniGame-Image-API';
const PANEL_ID = 'minigame-image-api-settings';

let settings = { ...DEFAULT_SETTINGS };
let initialized = false;
let initPromise = null;
let apiExposed = false;
const runtimeModels = new Map();
const providerLocks = new Map();

const INIT_TIMEOUT_MS = 15_000;
const INIT_POLL_MS = 100;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getContext() {
  const context = globalThis.SillyTavern?.getContext?.();
  if (!context) throw new Error('没有找到 SillyTavern 扩展上下文。');
  return context;
}

function getSettingsTarget() {
  return document.getElementById('extensions_settings')
    || document.getElementById('extensions_settings2');
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForSillyTavernUi(timeoutMs = INIT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  do {
    const context = globalThis.SillyTavern?.getContext?.();
    const target = getSettingsTarget();
    if (context?.extensionSettings && target) return { context, target };
    await delay(INIT_POLL_MS);
  } while (Date.now() < deadline);

  throw new Error('等待酒馆扩展设置区域超时。请刷新酒馆页面后重试。');
}

function getHeaders(options) {
  return getContext().getRequestHeaders(options);
}

async function request(path, init = {}) {
  const response = await fetch(path, { ...init, headers: init.headers || getHeaders() });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = null; }
    const message = parsed?.error?.message || parsed?.message || parsed?.error || text || response.statusText;
    throw new Error(`${message || '酒馆服务器请求失败'}（HTTP ${response.status}）`);
  }
  return response;
}

async function requestJson(path, init = {}) {
  const response = await request(path, init);
  if (response.status === 204) return {};
  return response.json();
}

async function requestText(path, init = {}) {
  return (await request(path, init)).text();
}

async function readSecretState() {
  return requestJson('/api/secrets/read', {
    method: 'POST',
    headers: getHeaders({ omitContentType: true })
  });
}

function getProvider(provider) {
  const id = Object.hasOwn(PROVIDERS, provider) ? provider : 'gemini';
  return { id, ...PROVIDERS[id] };
}

function getProviderSecrets(state, provider) {
  const definition = getProvider(provider);
  return definition.secretKey && Array.isArray(state?.[definition.secretKey]) ? state[definition.secretKey] : [];
}

async function rotateSecret(secretKey, id) {
  if (!secretKey || !id) return;
  await requestJson('/api/secrets/rotate', {
    method: 'POST',
    body: JSON.stringify({ key: secretKey, id })
  });
}

async function deleteSecret(secretKey, id) {
  if (!secretKey || !id) return;
  await requestJson('/api/secrets/delete', {
    method: 'POST',
    body: JSON.stringify({ key: secretKey, id })
  });
}

function validateCredential(provider, rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) throw new Error(`请填写${getProvider(provider).credentialLabel}。`);
  if (provider === 'vertex') {
    let json;
    try { json = JSON.parse(value); } catch (error) { throw new Error(`Vertex 服务账号 JSON 无效：${error.message}`); }
    if (!json?.project_id || !json?.client_email || !json?.private_key) {
      throw new Error('Vertex 服务账号 JSON 必须包含 project_id、client_email 和 private_key。');
    }
  }
  return value;
}

async function writeDedicatedSecret(provider, rawValue) {
  const definition = getProvider(provider);
  if (!definition.secretKey) throw new Error('本地生图服务不需要保存 API Key。');
  const value = validateCredential(provider, rawValue);
  const previousState = await readSecretState();
  const previousActive = getProviderSecrets(previousState, provider).find((secret) => secret.active);
  const oldPluginSecretId = settings.secretIds?.[provider] || '';
  const created = await requestJson('/api/secrets/write', {
    method: 'POST',
    body: JSON.stringify({
      key: definition.secretKey,
      value,
      label: `${SECRET_LABEL_PREFIX} · ${definition.label}`
    })
  });
  const secretId = String(created?.id || '');
  if (!secretId) throw new Error('酒馆没有返回密钥编号，凭据未保存。');

  if (previousActive?.id && previousActive.id !== oldPluginSecretId) {
    await rotateSecret(definition.secretKey, previousActive.id);
  }
  if (oldPluginSecretId && oldPluginSecretId !== secretId) {
    await deleteSecret(definition.secretKey, oldPluginSecretId)
      .catch((error) => console.warn(`[${DISPLAY_NAME}] 清理旧密钥失败`, error));
  }
  const nextState = await readSecretState();
  const saved = getProviderSecrets(nextState, provider).find((secret) => secret.id === secretId);
  settings.secretIds[provider] = secretId;
  settings.secretLabels[provider] = String(saved?.value || '已安全保存');
  saveSettings();
  return secretId;
}

function runSerialized(provider, task) {
  const previous = providerLocks.get(provider) || Promise.resolve();
  const current = previous.catch(() => {}).then(task);
  const tracked = current.catch(() => {}).finally(() => {
    if (providerLocks.get(provider) === tracked) providerLocks.delete(provider);
  });
  providerLocks.set(provider, tracked);
  return current;
}

async function withActiveProviderSecret(provider, task) {
  return runSerialized(provider, async () => {
    const definition = getProvider(provider);
    const secretId = settings.secretIds?.[provider];
    if (!definition.secretKey || !secretId) return task();
    const state = await readSecretState();
    const secrets = getProviderSecrets(state, provider);
    const pluginSecret = secrets.find((secret) => secret.id === secretId);
    if (!pluginSecret) throw new Error(`已保存的${definition.credentialLabel}不存在，请重新填写。`);
    const previousActive = secrets.find((secret) => secret.active);
    if (!pluginSecret.active) await rotateSecret(definition.secretKey, pluginSecret.id);
    try {
      return await task();
    } finally {
      if (previousActive?.id && previousActive.id !== pluginSecret.id) {
        await rotateSecret(definition.secretKey, previousActive.id).catch((error) => {
          console.error(`[${DISPLAY_NAME}] 恢复原活动密钥失败`, error);
        });
      }
    }
  });
}

async function getStatus(options = {}) {
  const provider = getProvider(options.provider || settings.provider);
  if (!provider.secretKey) {
    const apiUrl = settings.apiUrls?.[provider.id];
    return {
      installed: true,
      configured: Boolean(apiUrl),
      ready: Boolean(apiUrl),
      apiVersion: API_VERSION,
      extensionId: EXTENSION_ID,
      provider: provider.id,
      model: settings.models?.[provider.id] || '',
      message: apiUrl ? `${provider.label} 已配置；生成时会检查本地服务。` : `请填写 ${provider.label} API 地址。`
    };
  }

  let configured = false;
  let maskedKey = settings.secretLabels?.[provider.id] || '';
  let message = `尚未保存${provider.credentialLabel}。`;
  const secretId = settings.secretIds?.[provider.id];
  if (secretId) {
    try {
      const state = await readSecretState();
      const secret = getProviderSecrets(state, provider.id).find((item) => item.id === secretId);
      configured = Boolean(secret);
      maskedKey = String(secret?.value || maskedKey || '已安全保存');
      message = configured ? `${provider.label} 已安装并配置完成。` : `已保存的${provider.credentialLabel}不存在，请重新填写。`;
    } catch (error) {
      message = `无法读取酒馆密钥状态：${error.message}`;
    }
  }
  return {
    installed: true,
    configured,
    ready: configured,
    apiVersion: API_VERSION,
    extensionId: EXTENSION_ID,
    provider: provider.id,
    model: settings.models?.[provider.id] || '',
    maskedKey,
    message
  };
}

async function uploadImage(image, requestOptions, index) {
  const mimeType = image.mimeType || 'image/png';
  const format = mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpg' : mimeType.includes('webp') ? 'webp' : 'png';
  const result = await requestJson('/api/images/upload', {
    method: 'POST',
    body: JSON.stringify({
      image: image.data,
      format,
      ch_name: String(requestOptions.folder || 'minigame-image-api'),
      filename: sanitizeFileName(requestOptions.fileName || `minigame-image-${Date.now()}-${index + 1}`)
    })
  });
  if (!result?.path) throw new Error('图片已经生成，但保存到酒馆图片目录失败。');
  const path = String(result.path);
  return { ...image, path, url: new URL(path, globalThis.location.href).href };
}

async function generateGemini(provider, requestOptions) {
  const body = buildGeminiRequest(settings, requestOptions, provider);
  const execute = async () => requestJson('/api/backends/chat-completions/generate', {
    method: 'POST', body: JSON.stringify(body)
  });
  const response = provider === 'vertex' ? await withActiveProviderSecret(provider, execute) : await execute();
  if (response?.error) throw new Error(response.error?.message || response.message || 'Gemini 生图失败。');
  const images = extractGeminiImages(response);
  if (!images.length) throw new Error('Gemini 没有返回图片，请检查模型名称和提示词。');
  return { images, raw: response, model: body.model, aspectRatio: body.request_image_aspect_ratio, imageSize: body.request_image_resolution };
}

async function generateOpenAI(requestOptions) {
  const body = buildOpenAIRequest(settings, requestOptions);
  const response = await withActiveProviderSecret('openai', () => requestJson('/api/openai/generate-image', {
    method: 'POST', body: JSON.stringify(body)
  }));
  const image = makeImage('image/png', response?.data?.[0]?.b64_json);
  if (!image) throw new Error('OpenAI Images 没有返回 base64 图片数据。');
  return { images: [image], raw: response, model: body.model, aspectRatio: requestOptions.aspectRatio || settings.aspectRatio, imageSize: body.size };
}

async function generateStability(requestOptions) {
  const aspectRatio = normalizeAspectRatio(requestOptions.aspectRatio || settings.aspectRatio, requestOptions.width, requestOptions.height);
  const model = String(requestOptions.model || settings.models.stability);
  const base64 = await withActiveProviderSecret('stability', () => requestText('/api/sd/stability/generate', {
    method: 'POST',
    body: JSON.stringify({
      model,
      payload: {
        prompt: String(requestOptions.prompt || '').slice(0, 10000),
        negative_prompt: String(requestOptions.negativePrompt || '').slice(0, 10000),
        aspect_ratio: aspectRatio,
        seed: Number(requestOptions.seed ?? settings.seed) >= 0 ? Number(requestOptions.seed ?? settings.seed) : undefined,
        output_format: 'png'
      }
    })
  }));
  const image = makeImage('image/png', base64);
  if (!image) throw new Error('Stability AI 没有返回图片。');
  return { images: [image], raw: null, model, aspectRatio, imageSize: requestOptions.imageSize || settings.imageSize };
}

async function generateBfl(requestOptions) {
  const { width, height } = getDimensions(requestOptions, settings);
  const model = String(requestOptions.model || settings.models.bfl);
  const response = await withActiveProviderSecret('bfl', () => requestJson('/api/sd/bfl/generate', {
    method: 'POST',
    body: JSON.stringify({
      prompt: String(requestOptions.prompt || ''), model, width, height,
      steps: Number(requestOptions.steps || settings.steps),
      guidance: Number(requestOptions.cfgScale || settings.cfgScale),
      prompt_upsampling: Boolean(requestOptions.promptUpsampling),
      seed: Number(requestOptions.seed ?? settings.seed) >= 0 ? Number(requestOptions.seed ?? settings.seed) : undefined
    })
  }));
  const image = makeImage('image/jpeg', response?.image);
  if (!image) throw new Error('BFL 没有返回图片。');
  return { images: [image], raw: response, model, aspectRatio: normalizeAspectRatio(requestOptions.aspectRatio || settings.aspectRatio), imageSize: `${width}x${height}` };
}

async function generateA1111(requestOptions) {
  const body = buildA1111Request(settings, requestOptions);
  const response = await requestJson('/api/sd/generate', { method: 'POST', body: JSON.stringify(body) });
  const image = makeImage('image/png', response?.images?.[0]);
  if (!image) throw new Error('Stable Diffusion WebUI 没有返回图片。');
  return { images: [image], raw: response, model: requestOptions.model || settings.models.a1111, aspectRatio: normalizeAspectRatio(requestOptions.aspectRatio || settings.aspectRatio), imageSize: `${body.width}x${body.height}` };
}

async function generateComfy(requestOptions) {
  const apiUrl = String(requestOptions.apiUrl || settings.apiUrls.comfyui);
  const prompt = buildComfyPrompt(settings, requestOptions);
  const response = await requestJson('/api/sd/comfy/generate', {
    method: 'POST', body: JSON.stringify({ url: apiUrl, prompt })
  });
  const image = makeImage(`image/${response?.format || 'png'}`, response?.data);
  if (!image) throw new Error('ComfyUI 没有返回图片。');
  const dimensions = getDimensions(requestOptions, settings);
  return { images: [image], raw: response, model: requestOptions.model || settings.models.comfyui, aspectRatio: normalizeAspectRatio(requestOptions.aspectRatio || settings.aspectRatio), imageSize: `${dimensions.width}x${dimensions.height}` };
}

async function generate(requestOptions = {}) {
  const provider = getProvider(requestOptions.provider || settings.provider).id;
  const status = await getStatus({ provider });
  if (!status.ready) throw new Error(status.message);
  if (!String(requestOptions.prompt || '').trim()) throw new Error('生图提示词不能为空。');

  let generated;
  if (provider === 'gemini' || provider === 'vertex') generated = await generateGemini(provider, requestOptions);
  else if (provider === 'openai') generated = await generateOpenAI(requestOptions);
  else if (provider === 'stability') generated = await generateStability(requestOptions);
  else if (provider === 'bfl') generated = await generateBfl(requestOptions);
  else if (provider === 'a1111') generated = await generateA1111(requestOptions);
  else if (provider === 'comfyui') generated = await generateComfy(requestOptions);
  else throw new Error(`当前版本暂不支持生图服务：${provider}`);

  let images = generated.images;
  if (requestOptions.saveToSillyTavern) {
    images = await Promise.all(images.map((image, index) => uploadImage(image, requestOptions, index)));
  }
  return { ok: true, provider, ...generated, images };
}

async function discoverModels(provider = settings.provider) {
  const definition = getProvider(provider);
  if (definition.models.length) return definition.models.map((item) => ({ ...item, provider }));
  const apiUrl = settings.apiUrls?.[provider];
  const endpoint = provider === 'a1111' ? '/api/sd/models' : '/api/sd/comfy/models';
  const body = provider === 'a1111' ? { url: apiUrl, auth: settings.a1111Auth } : { url: apiUrl };
  const models = await requestJson(endpoint, { method: 'POST', body: JSON.stringify(body) });
  const normalized = Array.isArray(models)
    ? models.map((item) => ({ id: String(item.value || item.id || item), label: String(item.text || item.value || item) }))
    : [];
  runtimeModels.set(provider, normalized);
  return normalized.map((item) => ({ ...item, provider }));
}

async function testConnection(provider = settings.provider) {
  if (provider !== 'a1111' && provider !== 'comfyui') return getStatus({ provider });
  const endpoint = provider === 'a1111' ? '/api/sd/ping' : '/api/sd/comfy/ping';
  const body = provider === 'a1111'
    ? { url: settings.apiUrls.a1111, auth: settings.a1111Auth }
    : { url: settings.apiUrls.comfyui };
  await request(endpoint, { method: 'POST', body: JSON.stringify(body) });
  const models = await discoverModels(provider);
  return { installed: true, configured: true, ready: true, provider, models, message: `${getProvider(provider).label} 连接成功，发现 ${models.length} 个模型。` };
}

function saveSettings() {
  const context = getContext();
  context.extensionSettings[EXTENSION_ID] = { ...settings };
  context.saveSettingsDebounced();
}

function setStatus(message, kind = '') {
  const element = document.querySelector(`#${PANEL_ID} [data-role="status"]`);
  if (!element) return;
  element.textContent = message;
  element.dataset.kind = kind;
}

function setBusy(busy) {
  document.querySelectorAll(`#${PANEL_ID} button`).forEach((button) => { button.disabled = busy; });
}

function readForm() {
  const panel = document.getElementById(PANEL_ID);
  const provider = panel?.querySelector('[name="provider"]')?.value || 'gemini';
  return {
    provider,
    model: panel?.querySelector('[name="model"]')?.value || '',
    aspectRatio: panel?.querySelector('[name="aspectRatio"]')?.value || '1:1',
    imageSize: panel?.querySelector('[name="imageSize"]')?.value || '1K',
    apiUrl: panel?.querySelector('[name="apiUrl"]')?.value || '',
    vertexLocation: panel?.querySelector('[name="vertexLocation"]')?.value || 'global',
    a1111Auth: panel?.querySelector('[name="a1111Auth"]')?.value || '',
    workflowJson: panel?.querySelector('[name="workflowJson"]')?.value || '',
    sampler: panel?.querySelector('[name="sampler"]')?.value || 'euler',
    scheduler: panel?.querySelector('[name="scheduler"]')?.value || 'normal',
    steps: Number(panel?.querySelector('[name="steps"]')?.value || 28),
    cfgScale: Number(panel?.querySelector('[name="cfgScale"]')?.value || 7),
    seed: Number(panel?.querySelector('[name="seed"]')?.value || -1)
  };
}

function applyFormSettings() {
  const form = readForm();
  settings = normalizeSettings({
    ...settings,
    provider: form.provider,
    models: { ...settings.models, [form.provider]: form.model },
    aspectRatio: form.aspectRatio,
    imageSize: form.imageSize,
    vertexLocation: form.vertexLocation,
    apiUrls: { ...settings.apiUrls, [form.provider]: form.apiUrl || settings.apiUrls?.[form.provider] },
    a1111Auth: form.a1111Auth,
    comfyWorkflowJson: form.workflowJson,
    sampler: form.sampler,
    scheduler: form.scheduler,
    steps: form.steps,
    cfgScale: form.cfgScale,
    seed: form.seed
  });
  saveSettings();
}

function updateProviderUi(panel) {
  const provider = panel.querySelector('[name="provider"]').value;
  const definition = getProvider(provider);
  const modelInput = panel.querySelector('[name="model"]');
  const modelList = panel.querySelector('#minigame-image-api-models');
  const models = runtimeModels.get(provider) || definition.models;
  modelList.innerHTML = models.map((model) => `<option value="${escapeHtml(model.id)}">${escapeHtml(model.label)}</option>`).join('');
  modelInput.value = settings.models?.[provider] || models[0]?.id || '';

  panel.querySelectorAll('[data-provider-scope]').forEach((element) => {
    element.hidden = !element.dataset.providerScope.split(/\s+/).includes(provider);
  });
  const credentialLabel = panel.querySelector('[data-role="credential-label"]');
  if (credentialLabel) credentialLabel.textContent = definition.credentialLabel;
  panel.querySelector('[name="credential"]').hidden = definition.credentialType !== 'password';
  panel.querySelector('[name="credentialJson"]').hidden = definition.credentialType !== 'textarea';
  panel.querySelector('[data-action="save-key"]').hidden = !definition.secretKey;
  panel.querySelector('[data-action="discover-models"]').hidden = !['a1111', 'comfyui'].includes(provider);
  panel.querySelector('[data-role="credential-group"]').hidden = !definition.secretKey;
  const apiUrl = panel.querySelector('[name="apiUrl"]');
  if (apiUrl && settings.apiUrls?.[provider]) apiUrl.value = settings.apiUrls[provider];
  refreshKeyState(provider).catch((error) => setStatus(error.message, 'error'));
}

function renderSettings(target = getSettingsTarget()) {
  const existing = document.getElementById(PANEL_ID);
  if (existing) return existing;
  if (!target) throw new Error('没有找到酒馆扩展设置区域。');
  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.className = 'minigame-image-api-panel extension_container inline-drawer';
  panel.innerHTML = `
    <div class="inline-drawer-toggle inline-drawer-header">
      <b>${DISPLAY_NAME}</b><span class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></span>
    </div>
    <div class="inline-drawer-content">
      <p class="minigame-image-api-intro">为角色卡和酒馆小游戏提供独立、可编程的生图接口。云端凭据保存在酒馆服务器密钥库；本地请求由酒馆服务器转发，因此手机连接同一台酒馆时也能调用电脑上的 ComfyUI / WebUI。</p>
      <label>生图服务</label>
      <select name="provider" class="text_pole">
        ${Object.entries(PROVIDERS).map(([id, provider]) => `<option value="${id}" ${id === settings.provider ? 'selected' : ''}>${escapeHtml(provider.label)}</option>`).join('')}
      </select>
      <label>默认模型 / Checkpoint</label>
      <input name="model" class="text_pole" list="minigame-image-api-models" autocomplete="off">
      <datalist id="minigame-image-api-models"></datalist>
      <div data-role="credential-group">
        <label data-role="credential-label"></label>
        <input name="credential" class="text_pole" type="password" autocomplete="new-password" placeholder="粘贴后点击安全保存；不会写入扩展设置">
        <textarea name="credentialJson" class="text_pole minigame-image-api-workflow" spellcheck="false" placeholder="粘贴完整的服务账号 JSON"></textarea>
        <small data-role="key-state">正在读取密钥状态……</small>
      </div>
      <div data-provider-scope="vertex">
        <label>Vertex Location</label>
        <input name="vertexLocation" class="text_pole" value="${escapeHtml(settings.vertexLocation)}" placeholder="global">
      </div>
      <div data-provider-scope="a1111 comfyui">
        <label>本地 API 地址</label>
        <input name="apiUrl" class="text_pole" autocomplete="off">
      </div>
      <div data-provider-scope="a1111">
        <label>Basic Auth（可留空）</label>
        <input name="a1111Auth" class="text_pole" value="${escapeHtml(settings.a1111Auth)}" placeholder="用户名:密码">
      </div>
      <div data-provider-scope="comfyui">
        <label>ComfyUI API 工作流 JSON（可留空）</label>
        <textarea name="workflowJson" class="text_pole minigame-image-api-workflow" spellcheck="false" placeholder="留空时使用标准 checkpoint 文生图工作流；也支持 {{prompt}}、{{negative_prompt}}、{{width}}、{{height}}、{{seed}}、{{model}}、{{steps}}、{{cfg}} 占位符">${escapeHtml(settings.comfyWorkflowJson)}</textarea>
      </div>
      <div class="minigame-image-api-grid">
        <div><label>默认图片比例</label><select name="aspectRatio" class="text_pole">${ASPECT_RATIOS.map((ratio) => `<option value="${ratio}" ${ratio === settings.aspectRatio ? 'selected' : ''}>${ratio}</option>`).join('')}</select></div>
        <div><label>默认图片尺寸</label><select name="imageSize" class="text_pole">${IMAGE_SIZES.map((size) => `<option value="${size}" ${size === settings.imageSize ? 'selected' : ''}>${size}</option>`).join('')}</select></div>
      </div>
      <div class="minigame-image-api-grid" data-provider-scope="bfl a1111 comfyui">
        <div><label>采样步数</label><input name="steps" class="text_pole" type="number" min="1" max="150" value="${settings.steps}"></div>
        <div><label>CFG / Guidance</label><input name="cfgScale" class="text_pole" type="number" min="0" max="30" step="0.1" value="${settings.cfgScale}"></div>
        <div><label>Sampler</label><input name="sampler" class="text_pole" value="${escapeHtml(settings.sampler)}"></div>
        <div><label>Scheduler</label><input name="scheduler" class="text_pole" value="${escapeHtml(settings.scheduler)}"></div>
        <div><label>Seed（-1 随机）</label><input name="seed" class="text_pole" type="number" value="${settings.seed}"></div>
      </div>
      <div class="minigame-image-api-actions">
        <button type="button" class="menu_button" data-action="save-key">安全保存凭据</button>
        <button type="button" class="menu_button" data-action="discover-models">检测服务并读取模型</button>
        <button type="button" class="menu_button" data-action="save-defaults">保存默认参数</button>
        <button type="button" class="menu_button" data-action="test">测试生图</button>
      </div>
      <div class="minigame-image-api-status" data-role="status" aria-live="polite"></div>
      <img class="minigame-image-api-preview" data-role="preview" alt="测试生图结果" hidden>
      <p class="minigame-image-api-help">小游戏调用参数优先于这里的默认值。对尚不支持指定 secret_id 的酒馆云端路由，插件会在请求期间临时启用专用密钥，并在结束后恢复原密钥。</p>
      <a href="${REPOSITORY_URL}" target="_blank" rel="noopener noreferrer">项目主页与接口文档</a>
    </div>`;
  target.append(panel);

  panel.querySelector('[name="provider"]').addEventListener('change', () => updateProviderUi(panel));
  panel.addEventListener('click', async (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    setBusy(true);
    try {
      const form = readForm();
      if (action === 'save-key') {
        const credential = form.provider === 'vertex'
          ? panel.querySelector('[name="credentialJson"]')
          : panel.querySelector('[name="credential"]');
        await writeDedicatedSecret(form.provider, credential.value);
        credential.value = '';
        setStatus('凭据已安全保存到酒馆服务器。', 'success');
      } else if (action === 'save-defaults') {
        applyFormSettings();
        setStatus('默认参数已保存。', 'success');
      } else if (action === 'discover-models') {
        applyFormSettings();
        const result = await testConnection(form.provider);
        if (!settings.models[form.provider] && result.models[0]) {
          settings.models[form.provider] = result.models[0].id;
          saveSettings();
        }
        updateProviderUi(panel);
        setStatus(result.message, 'success');
      } else if (action === 'test') {
        const credential = form.provider === 'vertex'
          ? panel.querySelector('[name="credentialJson"]')
          : panel.querySelector('[name="credential"]');
        if (credential && !credential.hidden && credential.value.trim()) {
          await writeDedicatedSecret(form.provider, credential.value);
          credential.value = '';
        }
        applyFormSettings();
        setStatus('正在生成测试图片……');
        const result = await generate({
          prompt: 'A single pale purple camellia on a clean ivory background, elegant game UI asset, no text',
          negativePrompt: 'letters, watermark, low quality',
          ...readForm()
        });
        const preview = panel.querySelector('[data-role="preview"]');
        preview.src = result.images[0].dataUrl;
        preview.hidden = false;
        settings.lastTestedAt = new Date().toISOString();
        saveSettings();
        setStatus(`测试成功：${getProvider(result.provider).label} / ${result.model || '当前模型'}`, 'success');
      }
      await refreshKeyState(readForm().provider);
    } catch (error) {
      setStatus(error.message || '操作失败。', 'error');
    } finally {
      setBusy(false);
    }
  });
  updateProviderUi(panel);
  return panel;
}

async function refreshKeyState(provider = settings.provider) {
  const status = await getStatus({ provider });
  const element = document.querySelector(`#${PANEL_ID} [data-role="key-state"]`);
  if (element) element.textContent = status.ready && status.maskedKey ? `已配置：${status.maskedKey}` : status.message;
  return status;
}

function openSettings() {
  const panel = document.getElementById(PANEL_ID);
  if (!panel) {
    void init();
    return false;
  }
  if (panel.offsetParent === null) document.getElementById('extensionsMenuButton')?.click();
  const content = panel.querySelector(':scope > .inline-drawer-content');
  if (content && getComputedStyle(content).display === 'none') {
    panel.querySelector(':scope > .inline-drawer-toggle')?.click();
  }
  setTimeout(() => panel.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  return true;
}

function getModels(provider = settings.provider) {
  const definition = getProvider(provider);
  return (runtimeModels.get(provider) || definition.models).map((item) => ({ ...item, provider }));
}

function exposeApi() {
  if (apiExposed) return;
  apiExposed = true;
  globalThis.STMiniGameImage = Object.freeze({
    apiVersion: API_VERSION,
    extensionId: EXTENSION_ID,
    getStatus,
    generate,
    testConnection,
    discoverModels,
    openSettings,
    getModels
  });
  globalThis.dispatchEvent(new CustomEvent('st-minigame-image-ready', {
    detail: { apiVersion: API_VERSION, extensionId: EXTENSION_ID }
  }));
}

async function init() {
  if (initialized) return;
  exposeApi();
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const { context, target } = await waitForSillyTavernUi();
    settings = normalizeSettings(context.extensionSettings[EXTENSION_ID]);
    context.extensionSettings[EXTENSION_ID] = { ...settings };
    renderSettings(target);
    initialized = true;
    await refreshKeyState();
    console.info(`[${DISPLAY_NAME}] v0.2.1 已加载`);
  })().catch((error) => {
    console.error(`[${DISPLAY_NAME}] 初始化失败`, error);
    globalThis.toastr?.error?.(`${DISPLAY_NAME}加载失败：${error.message}`);
    throw error;
  }).finally(() => {
    if (!initialized) initPromise = null;
  });

  return initPromise;
}

function startInit() {
  void init().catch(() => {});
}

if (typeof globalThis.jQuery === 'function') {
  globalThis.jQuery(startInit);
} else if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startInit, { once: true });
} else {
  startInit();
}
