# 小游戏轻度生图插件

为 SillyTavern 角色卡提供独立、可编程的生图接口。云端凭据保存在 SillyTavern 服务器密钥库，不写入角色卡、对话变量或浏览器 localStorage。图片请求由酒馆服务器代发，手机连接同一台酒馆时也可以使用电脑上的密钥和本地生图服务。

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
- NovelAI / NAI Diffusion：Anime V4.5 Full / Curated、Anime V4 Full / Curated、Anime V3、Furry V3
- Black Forest Labs：FLUX Pro 系列
- Stable Diffusion WebUI / Forge：读取本地 checkpoint，可设置 Basic Auth、步数、CFG、采样器和种子
- ComfyUI：读取本地 checkpoint，可用内置标准文生图工作流，也可粘贴自定义 API 工作流 JSON

WebUI / Forge 启动时必须开启 API（通常在启动参数中加 `--api`），默认地址是 `http://127.0.0.1:7860`。ComfyUI 默认地址是 `http://127.0.0.1:8188`。两者都由 SillyTavern 服务器访问，手机端无需直连 `127.0.0.1`。

## NovelAI（NAI）

NAI 通常指 [NovelAI 的图片生成服务](https://docs.novelai.net/en/image/)。在插件中选择“NovelAI / NAI Diffusion”，填写 Persistent API Token，点击“安全保存凭据”。Token 在 NovelAI 的 Settings → Account → Get Persistent API Token 获取，参见[官方说明](https://docs.novelai.net/en/text/usersettings/account/)。

“验证 Token”只检查账户连接；“测试生图”会实际生成图片，按账户订阅规则消耗 Anlas。默认使用 V4.5 Full、1024×1024、28 步。NovelAI 有独立的默认参数，切换本地服务不会覆盖它们。此接入支持官方文生图，不提供第三方 NAI 中转地址、图生图、角色分区或参考图功能。

从 0.2.3 起，插件检查返回数据的 PNG 文件标识，并拒绝文字、HTML、JSON 和不完整数据，避免异常响应被误报为生图成功。模型栏也会拒绝 Kayra、Erato 等文字模型。若遇到“出文字”，请记录插件版本、酒馆版本、模型名，以及文字出现在插件预览、错误提示还是聊天楼层；截图不要包含 Token。自动测试使用图片样本和模拟服务器，不能代替真实账户的生图验证。

从 0.2.4 起，NAI 请求中的中文提示词或负面提示词先通过**酒馆当前连接的聊天补全文字模型**转成简短英文视觉描述，再请求 NAI 生图。每次中文生图会增加一次文字模型调用，使用该连接现有的密钥和计费；英文提示词直接发送。请先配置并连接文字模型。无法转换、仍含中文或结果不是规定格式时，插件停止 NAI 请求并显示错误，不将中文原文直接发送给扩散模型。

这个转换使用 SillyTavern 1.19.0 提供的 `getContext().ChatCompletionService.presetToGeneratePayload` / `sendRequest` 和 `getChatCompletionModel`，通过独立消息调用当前文字连接；不读角色卡、聊天历史或世界书，也不写聊天楼层。来源：[st-context.js](https://github.com/SillyTavern/SillyTavern/blob/1.19.0/public/scripts/st-context.js)、[custom-request.js](https://github.com/SillyTavern/SillyTavern/blob/1.19.0/public/scripts/custom-request.js)。这些能力由酒馆宿主提供，无需酒馆助手或额外翻译服务。

旧版《贵族学院的特招生》的头像/礼服提示词含有中文的“请使用 Gemini……0.5K”指令。插件识别这些请求后移除该指令，提取英文外观描述，并补上 `no text` 与禁止文字、文档、截图的负面标签。因此已有角色卡也能通过更新插件获得适配；普通英文 NAI API 请求中显式要求画文字的用法不受此规则影响。此修复针对提示词适配，不会修改已经保存的图片；更新后需要在角色页重新生成头像或礼服图片。

提示词依据：[NovelAI 模型文档](https://docs.novelai.net/en/image/models/)说明 V4/V4.5 的 T5 tokenizer 对多数 Unicode 字符支持有限；[文字渲染文档](https://docs.novelai.net/en/image/textrendering/)说明这些模型可以把文字画进图片。一个包含伪文字的 PNG 仍是真图片，文件校验无法判断它是否符合角色外观要求。

```js
const result = await window.STMiniGameImage.generate({
  provider: 'novelai',
  prompt: '1girl, solo, school uniform, portrait, detailed anime illustration',
  negativePrompt: 'text, watermark, low quality',
  width: 832,
  height: 1216,
  steps: 28,
  cfgScale: 5,
  sampler: 'k_euler_ancestral',
  scheduler: 'karras',
  seed: -1,
  saveToSillyTavern: true
});
```

省略参数时使用 NovelAI 专属默认值。宽高会对齐到 64 的倍数，步数限制在 1–50；也可用 `aspectRatio` 和 `imageSize` 推导尺寸，显式传入完整宽高时优先使用宽高。较大尺寸是否可生成取决于 NovelAI 的限制和账户余额。推荐选用列表内模型；可手填模型名，但未经验证的新模型可能需要更新酒馆。

接口依据为 SillyTavern **1.19.0** 的[服务器路由](https://github.com/SillyTavern/SillyTavern/blob/1.19.0/src/endpoints/novelai.js)与[内置生图调用](https://github.com/SillyTavern/SillyTavern/blob/1.19.0/public/scripts/extensions/stable-diffusion/index.js)。`/api/novelai/generate-image` 使用酒馆服务器保存的 `api_key_novel`，服务器负责解压生成结果并返回 PNG base64。无需另装 NovelAI 扩展或修改角色卡；插件沿用现有密钥切换与恢复逻辑。

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
- NovelAI Persistent API Token 也保存在服务器密钥库，扩展设置不保存 Token 明文。
- 扩展设置只保存密钥编号和遮罩信息，不保存凭据明文。
- Gemini 可以直接按密钥编号调用。对尚不支持 `secret_id` 的酒馆路由，插件会在请求期间串行地临时启用插件专用密钥，并在结束后恢复玩家原来的活动密钥。
- 生成结果可选上传到 SillyTavern `user/images` 目录，便于电脑和手机通过同一酒馆地址显示。

## 开发检查

```bash
npm test
npm run check
```
