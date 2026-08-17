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
如通过 Nginx 等反向代理部署到公网，在 `.env` 中设置 `PUBLIC_ORIGIN=https://你的域名`，让浏览器的同源请求通过来源校验。

若站点挂在子路径，例如 `https://anhao.net/learn`，前端构建和服务端必须使用相同路径：

```bash
VITE_BASE_PATH=/learn/
APP_BASE_PATH=/learn
PUBLIC_ORIGIN=https://anhao.net
npm run build
```

Nginx 应将 `/learn/` 转发（或映射）到应用，同时保留浏览器可访问的 `/learn/api/` 地址。

## 账户与同步

- 不登录时，生词、短语和复习记录只存于当前浏览器的 `localStorage`，不会发送到服务器。
- 使用邮箱注册/登录后，这些数据按账户保存到 SQLite 的云端数据库；不同账户互相不可见。
- 登录时会一次性合并当前浏览器中的本地生词和短语，再清理本地副本；云端已有条目不会被覆盖。
- 退出后，后续新收藏重新保存在当前浏览器；此前云端数据仍安全保留，重新登录即可恢复。
- 云端 JSON 导出与导入同样需要登录，导出的生词只包含当前账户。

GitHub 和 Google 登录是可选项。先在对应开发者控制台创建 OAuth 应用，并在服务器 `.env` 中填写：

```bash
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

为 OAuth 应用登记的回调地址必须与实际部署完全一致。例如部署到 `https://anhao.net/learn` 时：

```text
https://anhao.net/learn/api/auth/github/callback
https://anhao.net/learn/api/auth/google/callback
```

本地默认使用根路径，对应 `http://127.0.0.1:5173/api/auth/github/callback` 和 `http://127.0.0.1:5173/api/auth/google/callback`。OAuth 密钥只保存在服务器环境变量中，不会返回浏览器、写入 `localStorage` 或提交到 Git。

OAuth 回调由服务器交换授权码，因此生产服务器必须能通过 HTTPS 访问 `oauth2.googleapis.com`、`openidconnect.googleapis.com`、`github.com` 和 `api.github.com`。当前服务器无法直连这些地址时，即使浏览器已完成授权也不会创建登录会话；需要为服务器开放出网，或配置可用的 HTTPS 代理后再重试。

从旧版无账户服务升级时，如服务器 `data/echoline.db` 已有全局生词本，可在首次上线前临时配置 `LEGACY_VOCABULARY_OWNER_EMAIL=你的注册邮箱`。该邮箱首次登录后，旧数据会一次性复制到该账户；未设置时旧数据保留在数据库备份中但不会展示给任何账户，以避免误泄露。

## 翻译与词典

- DeepLearning.AI 公开课时会导入英文字幕；YouTube 公开视频会使用官方嵌入播放器，并在视频发布者提供公开英文字幕时导入。
- 有官方中文字幕时直接保存并使用，不调用外部翻译接口。
- 没有官方中文字幕时，页面不会自动翻译。用户点击某句旁边的“免费翻译本句”后，才调用 MyMemory 免费接口翻译该句，不使用 LLM，也不需要 OpenAI Key。
- 如希望翻译内容不发送到公共服务，可自行部署 LibreTranslate，并设置 `TRANSLATION_PROVIDER=libretranslate` 与 `LIBRETRANSLATE_URL`。
- 单句翻译以英文字幕哈希、翻译提供方和接口版本为缓存键保存到 SQLite；重复点击、刷新、切集或重启不会重复请求。
- MyMemory 有免费额度限制；额度用完后英文字幕和播放器仍可正常使用，稍后可以再次点击翻译。
- 首次使用前运行 `npm run dictionary:install`，安装约 77 万词条的 ECDICT 离线英汉词典；默认保存到 `data/dictionaries/ecdict.db`。
- 查词只使用 ECDICT/内置英汉释义作为中文词义，不再把免费英文接口的英文 definition 当成中文翻译。若显式配置 `DICTIONARY_REMOTE_SUPPLEMENT=true`，Free Dictionary 仅补充发音和英文例句。
- 打开播放器右侧的“生词本”后，可在查词栏切换“英汉词典”和“汉英词典”；汉英查询会从 ECDICT 的中文释义中反查英文词条，全程离线。
- 在同一句英文字幕中拖选两个或以上单词，即可添加短语并手动确认中文释义；短语会在原句高亮，并与单词一起按每 10 项分组复习。

ECDICT 数据来自 [skywind3000/ECDICT](https://github.com/skywind3000/ECDICT)，按其 MIT License 使用；大型词典数据库只下载到用户本机，不提交到 Git，也不随 EchoLine 重新分发。

字幕导入时会把网站按时间切开的 VTT 小片段重新组合为完整语义句。句界采用英文句子分割规则，长停顿仍保留为独立片段，逐句学习不再从句子中间开始。

## 数据

本地数据库默认位于 `data/echoline.db`，包含：

- 课程、稳定课时 ID 和集数顺序
- 每集英文字幕、官方/免费接口中文翻译和版本哈希
- 播放位置、有效播放时间、学习会话时间和完成句子
- 登录用户的生词、短语、每 10 个词的复习分组和复习记录；匿名用户则保存在浏览器本地
- 词典缓存和全局设置

首次运行会迁移旧版本 `localStorage` 的课程、生词、统计和显示偏好。课程管理页可导出或导入 JSON 备份；如需完整数据库快照，在停止服务后复制 `data/echoline.db`。

## 已实现的可靠性措施

- 切集先暂停媒体并清空字幕，再请求目标课时清单。
- 请求使用取消信号和 `lessonId + manifestRevision` 隔离，旧响应不能覆盖新课时。
- HLS 网络/媒体错误先恢复，致命错误重新解析临时签名地址。
- 解析器限制 HTTPS 和来源域名白名单，校验 DNS、逐跳重定向、响应大小和超时，并对 API 限流。
- TypeScript 和 Zod 校验前后端边界；测试覆盖 VTT、字幕哈希、课时隔离、课程去重、排序和 API 来源限制。
- 课程管理、播放器和复习使用可刷新深链接；暗色、视频隐藏和学习模式重复次数为全局持久设置。

## 检查

```bash
npm run check
npm run test:e2e
```

`npm run check` 依次执行类型检查、lint、单元/API 测试和生产构建；`npm run test:e2e` 使用真实 Chromium 验证快速切集时旧字幕请求无法覆盖新课时。CI 执行全部检查。

## 使用边界

v1 支持公开的 `learn.deeplearning.ai` 课时页面和 YouTube 视频链接（`youtube.com`、`youtu.be`）。YouTube 使用官方 IFrame 播放器，不解析、下载或重新分发视频流；仅尝试读取公开视频已有的英文字幕。没有公开英文字幕的视频仍可播放，但无法使用逐句学习、查词和短语功能。应用不读取浏览器 Cookie，也不支持登录后资源。使用第三方课程内容时，应遵守来源网站条款和版权要求。
