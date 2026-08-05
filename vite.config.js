import { defineConfig } from 'vite';

const ALLOWED_HOST = 'learn.deeplearning.ai';

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(payload));
}

function mediaResolver(request, response, next) {
  const requestUrl = new URL(request.url, 'http://localhost');
  if (requestUrl.pathname !== '/api/resolve-media') {
    next();
    return;
  }

  const source = requestUrl.searchParams.get('url');
  let lessonUrl;
  try {
    lessonUrl = new URL(source);
  } catch {
    sendJson(response, 400, { error: '课程网页地址无效' });
    return;
  }

  if (lessonUrl.protocol !== 'https:' || lessonUrl.hostname !== ALLOWED_HOST) {
    sendJson(response, 400, { error: '只支持解析 learn.deeplearning.ai 的 HTTPS 课程页面' });
    return;
  }

  fetch(lessonUrl, {
    headers: { 'User-Agent': 'EchoLine/0.1 media resolver' },
    signal: AbortSignal.timeout(15000),
  }).then(async (upstream) => {
    if (!upstream.ok) throw new Error(`课程页面返回 ${upstream.status}`);
    if (new URL(upstream.url).hostname !== ALLOWED_HOST) throw new Error('课程页面跳转到了不受支持的网站');
    const html = (await upstream.text())
      .replace(/\\u0026/g, '&')
      .replace(/&amp;/g, '&')
      .replace(/\\\//g, '/');
    const candidates = html.match(/https:\/\/video\.deeplearning\.ai\/[^\s"'<>]+\.m3u8[^\s"'<>]*/g) || [];
    const mediaUrl = candidates.find((value) => value.includes('-master.m3u8')) || candidates[0];
    if (!mediaUrl) {
      sendJson(response, 404, { error: '课程页面中没有找到可播放的媒体流' });
      return;
    }
    sendJson(response, 200, { mediaUrl });
  }).catch((error) => {
    sendJson(response, 502, { error: error.message || '课程页面解析失败' });
  });
}

const mediaResolverPlugin = {
  name: 'echoline-media-resolver',
  configureServer(server) {
    server.middlewares.use(mediaResolver);
  },
  configurePreviewServer(server) {
    server.middlewares.use(mediaResolver);
  },
};

export default defineConfig({
  plugins: [mediaResolverPlugin],
});
