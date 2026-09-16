import {
  API_VERSION,
  ASPECT_RATIOS,
  DEFAULT_SETTINGS,
  EXTENSION_ID,
  GEMINI_IMAGE_MODELS,
  GEMINI_SECRET_KEY,
  IMAGE_SIZES,
  buildGeminiRequest,
  extractGeminiImages,
  normalizeSettings,
  sanitizeFileName
} from './core.js';

const DISPLAY_NAME = '小游戏轻度生图插件';
const SECRET_LABEL = DISPLAY_NAME;
const REPOSITORY_URL = 'https://github.com/sarah707/SillyTavern-MiniGame-Image-API';
const PANEL_ID = 'minigame-image-api-settings';

let settings = { ...DEFAULT_SETTINGS };
let initialized = false;

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

function getHeaders(options) {
  return getContext().getRequestHeaders(options);
}

async function requestJson(path, init = {}) {
  const response = await fetch(path, {
    ...init,
    headers: init.headers || getHeaders()
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || data?.message || data?.error || response.statusText;
    throw new Error(`${message || '酒馆服务器请求失败'}（HTTP ${response.status}）`);
  }
  return data;
}

async function readSecretState() {
  return requestJson('/api/secrets/read', {
    method: 'POST',
    headers: getHeaders({ omitContentType: true })
  });
}

function getGeminiSecrets(state) {
  return Array.isArray(state?.[GEMINI_SECRET_KEY]) ? state[GEMINI_SECRET_KEY] : [];
}

async function rotateSecret(id) {
  if (!id) return;
  await requestJson('/api/secrets/rotate', {
    method: 'POST',
    body: JSON.stringify({ key: GEMINI_SECRET_KEY, id })
  });
}

async function deleteSecret(id) {
  if (!id) return;
  await requestJson('/api/secrets/delete', {
    method: 'POST',
    body: JSON.stringify({ key: GEMINI_SECRET_KEY, id })
  });
}

async function writeDedicatedSecret(apiKey) {
  const value = String(apiKey || '').trim();
  if (!value) throw new Error('请填写 Gemini API Key。');
  const previousState = await readSecretState();
  const previousActive = getGeminiSecrets(previousState).find((secret) => secret.active);
  const oldPluginSecretId = settings.secretId;
  const created = await requestJson('/api/secrets/write', {
    method: 'POST',
    body: JSON.stringify({ key: GEMINI_SECRET_KEY, value, label: SECRET_LABEL })
  });
  const secretId = String(created?.id || '');
  if (!secretId) throw new Error('酒馆没有返回密钥编号，API Key 未保存。');

  if (previousActive?.id && previousActive.id !== oldPluginSecretId) {
    await rotateSecret(previousActive.id);
  }
  if (oldPluginSecretId && oldPluginSecretId !== secretId) {
    await deleteSecret(oldPluginSecretId).catch((error) => console.warn(`[${DISPLAY_NAME}] 清理旧密钥失败`, error));
  }

  const nextState = await readSecretState();
  const saved = getGeminiSecrets(nextState).find((secret) => secret.id === secretId);
  settings.secretId = secretId;
  settings.secretLabel = String(saved?.value || '已安全保存');
  saveSettings();
  return secretId;
}

async function getStatus() {
  let configured = false;
  let maskedKey = settings.secretLabel;
  let message = '尚未保存 Gemini API Key。';
  if (settings.secretId) {
    try {
      const state = await readSecretState();
      const secret = getGeminiSecrets(state).find((item) => item.id === settings.secretId);
      configured = Boolean(secret);
      maskedKey = String(secret?.value || maskedKey || '已安全保存');
      message = configured ? '插件已安装并配置完成。' : '已保存的密钥不存在，请重新填写 API Key。';
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
    provider: settings.provider,
    model: settings.model,
    maskedKey,
    message
  };
}

async function uploadImage(image, request, index) {
  const mimeType = image.mimeType || 'image/png';
  const format = mimeType.includes('jpeg') || mimeType.includes('jpg')
    ? 'jpg'
    : mimeType.includes('webp') ? 'webp' : 'png';
  const result = await requestJson('/api/images/upload', {
    method: 'POST',
    body: JSON.stringify({
      image: image.data,
      format,
      ch_name: String(request.folder || 'minigame-image-api'),
      filename: sanitizeFileName(request.fileName || `minigame-image-${Date.now()}-${index + 1}`)
    })
  });
  if (!result?.path) throw new Error('图片已经生成，但保存到酒馆图片目录失败。');
  const path = String(result.path);
  return {
    ...image,
    path,
    url: new URL(path, globalThis.location.href).href
  };
}

async function generate(request = {}) {
  const status = await getStatus();
  if (!status.ready) throw new Error(status.message);
  const provider = String(request.provider || settings.provider || 'gemini');
  if (provider !== 'gemini') throw new Error(`当前版本暂不支持生图服务：${provider}`);

  const body = buildGeminiRequest(settings, request);
  const response = await requestJson('/api/backends/chat-completions/generate', {
    method: 'POST',
    body: JSON.stringify(body)
  });
  if (response?.error) {
    throw new Error(response.error?.message || response.message || 'Gemini 生图失败。');
  }
  let images = extractGeminiImages(response);
  if (!images.length) throw new Error('Gemini 没有返回图片，请检查模型名称和提示词。');
  if (request.saveToSillyTavern) {
    images = await Promise.all(images.map((image, index) => uploadImage(image, request, index)));
  }
  return {
    ok: true,
    provider,
    model: body.model,
    aspectRatio: body.request_image_aspect_ratio,
    imageSize: body.request_image_resolution,
    images,
    raw: response
  };
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
  document.querySelectorAll(`#${PANEL_ID} button`).forEach((button) => {
    button.disabled = busy;
  });
}

function readForm() {
  const panel = document.getElementById(PANEL_ID);
  return {
    provider: panel?.querySelector('[name="provider"]')?.value || 'gemini',
    model: panel?.querySelector('[name="model"]')?.value || DEFAULT_SETTINGS.model,
    aspectRatio: panel?.querySelector('[name="aspectRatio"]')?.value || DEFAULT_SETTINGS.aspectRatio,
    imageSize: panel?.querySelector('[name="imageSize"]')?.value || DEFAULT_SETTINGS.imageSize
  };
}

function applyFormSettings() {
  settings = normalizeSettings({ ...settings, ...readForm() });
  saveSettings();
}

function renderSettings() {
  if (document.getElementById(PANEL_ID)) return;
  const target = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
  if (!target) throw new Error('没有找到酒馆扩展设置区域。');
  const panel = document.createElement('details');
  panel.id = PANEL_ID;
  panel.className = 'minigame-image-api-panel inline-drawer';
  panel.innerHTML = `
    <summary class="inline-drawer-toggle inline-drawer-header">
      <b>${DISPLAY_NAME}</b>
      <span class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></span>
    </summary>
    <div class="inline-drawer-content">
      <p class="minigame-image-api-intro">为角色卡和酒馆小游戏提供独立、可编程的轻量生图接口。API Key 保存在酒馆服务器的密钥库中，不写入角色卡或聊天记录。</p>
      <label>生图服务</label>
      <select name="provider" class="text_pole">
        <option value="gemini">Gemini AI Studio</option>
      </select>
      <label>默认模型</label>
      <input name="model" class="text_pole" list="minigame-image-api-models" autocomplete="off" value="${escapeHtml(settings.model)}">
      <datalist id="minigame-image-api-models">
        ${GEMINI_IMAGE_MODELS.map((model) => `<option value="${model.id}">${model.label}</option>`).join('')}
      </datalist>
      <div class="minigame-image-api-grid">
        <div>
          <label>默认图片比例</label>
          <select name="aspectRatio" class="text_pole">
            ${ASPECT_RATIOS.map((ratio) => `<option value="${ratio}" ${ratio === settings.aspectRatio ? 'selected' : ''}>${ratio}</option>`).join('')}
          </select>
        </div>
        <div>
          <label>默认图片尺寸</label>
          <select name="imageSize" class="text_pole">
            ${IMAGE_SIZES.map((size) => `<option value="${size}" ${size === settings.imageSize ? 'selected' : ''}>${size}</option>`).join('')}
          </select>
        </div>
      </div>
      <label>专用 Gemini API Key</label>
      <input name="apiKey" class="text_pole" type="password" autocomplete="new-password" placeholder="粘贴后点击安全保存；不会保存在扩展设置中">
      <small data-role="key-state">正在读取密钥状态……</small>
      <div class="minigame-image-api-actions">
        <button type="button" class="menu_button" data-action="save-key">安全保存 API Key</button>
        <button type="button" class="menu_button" data-action="save-defaults">保存默认参数</button>
        <button type="button" class="menu_button" data-action="test">测试生图</button>
      </div>
      <div class="minigame-image-api-status" data-role="status" aria-live="polite"></div>
      <img class="minigame-image-api-preview" data-role="preview" alt="测试生图结果" hidden>
      <p class="minigame-image-api-help">调用方可以单独传入模型、正负面提示词、比例、尺寸、宽高和保存目录；调用参数优先于这里的默认值。</p>
      <a href="${REPOSITORY_URL}" target="_blank" rel="noopener noreferrer">项目主页与接口文档</a>
    </div>`;
  target.append(panel);

  panel.querySelector('[name="provider"]').value = settings.provider;
  panel.addEventListener('click', async (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    setBusy(true);
    try {
      if (action === 'save-key') {
        const input = panel.querySelector('[name="apiKey"]');
        await writeDedicatedSecret(input.value);
        input.value = '';
        setStatus('API Key 已安全保存到酒馆服务器。', 'success');
      } else if (action === 'save-defaults') {
        applyFormSettings();
        setStatus('默认参数已保存。', 'success');
      } else if (action === 'test') {
        const input = panel.querySelector('[name="apiKey"]');
        if (input.value.trim()) {
          await writeDedicatedSecret(input.value);
          input.value = '';
        }
        applyFormSettings();
        setStatus('正在生成测试图片……');
        const result = await generate({
          prompt: 'A single pale purple camellia on a clean ivory background, elegant game UI asset, no text',
          ...readForm()
        });
        const preview = panel.querySelector('[data-role="preview"]');
        preview.src = result.images[0].dataUrl;
        preview.hidden = false;
        settings.lastTestedAt = new Date().toISOString();
        saveSettings();
        setStatus('测试成功，插件可以接受小游戏的生图请求。', 'success');
      }
      await refreshKeyState();
    } catch (error) {
      setStatus(error.message || '操作失败。', 'error');
    } finally {
      setBusy(false);
    }
  });
}

async function refreshKeyState() {
  const status = await getStatus();
  const element = document.querySelector(`#${PANEL_ID} [data-role="key-state"]`);
  if (element) {
    element.textContent = status.ready
      ? `已配置：${status.maskedKey}`
      : status.message;
  }
  return status;
}

function openSettings() {
  const panel = document.getElementById(PANEL_ID);
  if (!panel) return false;
  panel.open = true;
  const menuButton = document.getElementById('extensionsMenuButton');
  if (panel.offsetParent === null) menuButton?.click();
  setTimeout(() => panel.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  return true;
}

function exposeApi() {
  globalThis.STMiniGameImage = Object.freeze({
    apiVersion: API_VERSION,
    extensionId: EXTENSION_ID,
    getStatus,
    generate,
    openSettings,
    getModels: () => GEMINI_IMAGE_MODELS.map((item) => ({ ...item, provider: 'gemini' }))
  });
  globalThis.dispatchEvent(new CustomEvent('st-minigame-image-ready', {
    detail: { apiVersion: API_VERSION, extensionId: EXTENSION_ID }
  }));
}

async function init() {
  if (initialized) return;
  initialized = true;
  const context = getContext();
  settings = normalizeSettings(context.extensionSettings[EXTENSION_ID]);
  context.extensionSettings[EXTENSION_ID] = { ...settings };
  renderSettings();
  exposeApi();
  await refreshKeyState();
  console.info(`[${DISPLAY_NAME}] v0.1.0 已加载`);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void init(), { once: true });
} else {
  void init();
}
