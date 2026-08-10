# EchoLine

EchoLine 是一个面向精听、影子跟读和生词复习的本地 AI 英语学习播放器。每个课时拥有独立媒体、字幕、翻译缓存和学习进度，切换集数不会复用上一集字幕。

## 运行

要求 Node.js 22 或更新版本。

```bash
npm install
cp .env.example .env
npm run dev
```

开发地址为 `http://127.0.0.1:5173`。生产构建和本地服务：

```bash
npm run build
npm start
```

生产地址为 `http://127.0.0.1:4173`。服务默认只监听本机。

## 翻译与词典

- 导入公开课时后，英文字幕立即可用。
- 有官方中文字幕时直接保存并使用，不调用外部翻译接口。
- 没有官方中文字幕时，页面不会自动翻译。用户点击某句旁边的“免费翻译本句”后，才调用 MyMemory 免费接口翻译该句，不使用 LLM，也不需要 OpenAI Key。
- 如希望翻译内容不发送到公共服务，可自行部署 LibreTranslate，并设置 `TRANSLATION_PROVIDER=libretranslate` 与 `LIBRETRANSLATE_URL`。
- 单句翻译以英文字幕哈希、翻译提供方和接口版本为缓存键保存到 SQLite；重复点击、刷新、切集或重启不会重复请求。
- MyMemory 有免费额度限制；额度用完后英文字幕和播放器仍可正常使用，稍后可以再次点击翻译。
- 首次使用前运行 `npm run dictionary:install`，安装约 77 万词条的 ECDICT 离线英汉词典；默认保存到 `data/dictionaries/ecdict.db`。
- 查词只使用 ECDICT/内置英汉释义作为中文词义，不再把免费英文接口的英文 definition 当成中文翻译。若显式配置 `DICTIONARY_REMOTE_SUPPLEMENT=true`，Free Dictionary 仅补充发音和英文例句。

ECDICT 数据来自 [skywind3000/ECDICT](https://github.com/skywind3000/ECDICT)，按其 MIT License 使用；大型词典数据库只下载到用户本机，不提交到 Git，也不随 EchoLine 重新分发。

字幕导入时会把网站按时间切开的 VTT 小片段重新组合为完整语义句。句界采用英文句子分割规则，长停顿仍保留为独立片段，逐句学习不再从句子中间开始。

## 数据

本地数据库默认位于 `data/echoline.db`，包含：

- 课程、稳定课时 ID 和集数顺序
- 每集英文字幕、官方/免费接口中文翻译和版本哈希
- 播放位置、有效播放时间、学习会话时间和完成句子
- 生词、每 10 个词的复习分组、词典缓存和全局设置

首次运行会迁移旧版本 `localStorage` 的课程、生词、统计和显示偏好。课程管理页可导出或导入 JSON 备份；如需完整数据库快照，在停止服务后复制 `data/echoline.db`。

## 已实现的可靠性措施

- 切集先暂停媒体并清空字幕，再请求目标课时清单。
- 请求使用取消信号和 `lessonId + manifestRevision` 隔离，旧响应不能覆盖新课时。
- HLS 网络/媒体错误先恢复，致命错误重新解析临时签名地址。
- 解析器限制 HTTPS 和域名白名单，校验 DNS、逐跳重定向、响应大小和超时，并对 API 限流。
- TypeScript 和 Zod 校验前后端边界；测试覆盖 VTT、字幕哈希、课时隔离、课程去重、排序和 API 来源限制。
- 课程管理、播放器和复习使用可刷新深链接；暗色与视频隐藏为全局持久设置。

## 检查

```bash
npm run check
npm run test:e2e
```

`npm run check` 依次执行类型检查、lint、单元/API 测试和生产构建；`npm run test:e2e` 使用真实 Chromium 验证快速切集时旧字幕请求无法覆盖新课时。CI 执行全部检查。

## 使用边界

v1 只解析公开的 `learn.deeplearning.ai` HTTPS 课时页面，不读取浏览器 Cookie，也不支持登录后资源。EchoLine 不下载或重新分发完整视频，只在用户本机保存学习所需的元数据、字幕、翻译和进度。使用第三方课程内容时，应遵守来源网站条款和版权要求。
