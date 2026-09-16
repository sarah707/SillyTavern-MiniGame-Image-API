# 小游戏轻度生图插件

为 SillyTavern 角色卡提供独立、可编程的生图接口。云端凭据保存在 SillyTavern 服务器密钥库，不写入角卡、对话变量或浏览器 localStorage。图片请求由酒馆服务器代发，手机连接同一台酒馆时也可以使用电脑上的密钥和本地生图服务。

## 安装

在 SillyTavern 中打开“扩展” → “安装扩展”，粘贴：

```text
https://github.com/sarah707/SillyTavern-MiniGame-Image-API
```

安装后刷新 SillyTavern，在扩展设置中展开“小游戏轻度生图插件”，选择服务、保存凭据或本地 API 地址，再点击“测试生图”。

需要 SillyTavern 1.19.0 或更高版本。

## 支持的服务

- Gemini AI Studio：`gemini-3.1-flash-image`（默认）、`gemini-3-pro-image`、`gemini-2.5-flash-image`
- Google Vertex AI：使用服务账号 JSON，支持上述 Gemini Image 模型与可配置 Location
- OpenAI Images：GPT Image 系列，模型名也可手动填写
- Stability AI：Stable Image Ultra、Core、Stable Diffusion 3 / 3.5
- Black Forest Labs：FLUX Pro 系列
- Stable Diffusion WebUI / Forge：读取本地 checkpoint，可设置 Basic Auth、步数、CFG、采样器和种子
- ComfyUI：读取本地 checkpoint，可用内置标准文生图工作流，也可粘贴自定义 API 工作流 JSON

WebUI / Forge 启动时必须开启 API（通常在启动参数中加 `--api`），默认地址是 `http://127.0.0.1:7860`。ComfyUI 默认地址是 `http://127.0.0.1:8188`。两者都由 SillyTavern 服务器访问，手机端无需直连 `127.0.0.1`。

## ComfyUI 自定义工作流

在 ComfyUI 中使用“Save (API Format)”导出工作流，再粘贴到插件设置。可在 JSON 字符串或完整字段中使用：

```text
{{prompt}} {{negative_prompt}} {{width}} {{height}} {{seed}}
{{model}} {{sampler}} {{scheduler}} {{steps}} {{cfg}}
```

如果留空，插件会生成一套仅依赖 ComfyUI 基础节点的 checkpoint 文生图工作流。

## JavaScript API

扩展加载后会暴露：

```js
window.STMiniGameImage
```

检测指定服务：

```js
const status = await window.STMiniGameImage.getStatus({ provider: 'gemini' });
if (status.ready) console.log('生图可用');
```

生成并保存图片：

```js
const result = await window.STMiniGameImage.generate({
  provider: 'gemini',
  model: 'gemini-3.1-flash-image',
  prompt: 'A refined character portrait...',
  negativePrompt: 'text, watermark',
  aspectRatio: '1:1',
  imageSize: '1K',
  saveToSillyTavern: true,
  folder: 'my-minigame',
  fileName: 'character-avatar'
});

const firstImageUrl = result.images[0].url;
```

调用本地服务时只需更换 `provider`，也可传入 `width`、`height`、`steps`、`cfgScale`、`sampler`、`scheduler`、`seed`、`apiUrl`和 `workflowJson`。调用参数优先于扩展设置中的默认值。

另外提供：

```js
await window.STMiniGameImage.testConnection('comfyui');
await window.STMiniGameImage.discoverModels('comfyui');
window.STMiniGameImage.getModels('gemini');
window.STMiniGameImage.openSettings();
```

扩展加载完成时还会派发 `st-minigame-image-ready` 事件。

## 安全说明

- API Key 和 Vertex 服务账号 JSON 通过 SillyTavern `/api/secrets` 接口保存。
- 扩展设置只保存密钥编号和遮罩信息，不保存凭据明文。
- Gemini 可以直接按密钥编号调用。对尚不支持 `secret_id` 的酒馆路由，插件会在请求期间串行地临时启用插件专用密钥，并在结束后恢复玩家原来的活动密钥。
- 生成结果可选上传到 SillyTavern `user/images` 目录，便于电脑和手机通过同一酒馆地址显示。

## 开发检查

```bash
npm test
npm run check
```
