# 小游戏轻度生图插件

为 SillyTavern 角色卡提供独立、可编程的轻量生图接口。玩家可以使用与当前文字模型完全不同的 Gemini API Key；密钥保存到 SillyTavern 服务器密钥库，不会写入角色卡、对话变量或浏览器本地存储。

## 安装

在 SillyTavern 中打开“扩展” → “安装扩展”，粘贴：

```text
https://github.com/sarah707/SillyTavern-MiniGame-Image-API
```

安装后刷新 SillyTavern，在扩展设置中展开“小游戏轻度生图插件”，填写专用 Gemini API Key 并点击“安全保存 API Key”，然后执行一次“测试生图”。

要求 SillyTavern 1.19.0 或更高版本，以确保服务器端支持 `gemini-3.1-flash-image` 图片响应。

## 当前支持

- Gemini AI Studio
- `gemini-3.1-flash-image`（默认）
- `gemini-3-pro-image`
- `gemini-2.5-flash-image`
- 代码控制正面提示词、负面提示词、模型、比例、图片尺寸、宽高和保存目录
- 可选上传到 SillyTavern `user/images` 目录

扩展采用 Provider 适配层设计，后续可增加其他生图服务，而不改变小游戏调用接口。

## JavaScript API

扩展加载后会暴露：

```js
window.STMiniGameImage
```

检测状态：

```js
const status = await window.STMiniGameImage.getStatus();
if (status.ready) {
  console.log('生图可用');
}
```

生成图片：

```js
const result = await window.STMiniGameImage.generate({
  provider: 'gemini',
  model: 'gemini-3.1-flash-image',
  prompt: 'A refined character portrait...',
  negativePrompt: 'text, watermark',
  aspectRatio: '1:1',
  imageSize: '1K',
  // 也可以传 width / height，由插件选择最接近的受支持比例与尺寸。
  saveToSillyTavern: true,
  folder: 'my-minigame',
  fileName: 'character-avatar'
});

const firstImageUrl = result.images[0].url;
```

调用参数优先于扩展设置中的默认值。若 `saveToSillyTavern` 为 `false`，返回项仍包含 `mimeType`、`data` 和 `dataUrl`，便于小游戏在上传前裁切或制作缩略图。

打开设置：

```js
window.STMiniGameImage.openSettings();
```

扩展加载完成时还会派发 `st-minigame-image-ready` 事件。

## 安全说明

- API Key 通过 SillyTavern `/api/secrets` 接口保存。
- 扩展设置只保存密钥编号和遮罩信息，不保存 API Key 明文。
- 扩展调用 Gemini 时由 SillyTavern 服务器代发请求。
- 新建插件专用密钥后，会恢复玩家此前正在使用的 Gemini 密钥；生图请求通过专用密钥编号调用，不切换玩家当前文字模型。

## 开发检查

```bash
npm test
npm run check
```
