# Pixiv Proxy (全功能 Pixiv API 与图片反向代理网关)

基于 Cloudflare Workers 构建的高性能 Pixiv 全功能反向代理网关。

不仅支持 Pixiv 图片 CDN（包括动图 Ugoira ZIP），更原生支持 Pixiv 官方 App API 与 OAuth 登录鉴权，可无缝对接 [PixEz Flutter](https://github.com/Notsfsssf/pixez-flutter)、Shaft、Pixiv-Viewer 等第三方客户端或 Web 前端。

> 仅用于个人学习和合法用途。请遵守 Pixiv 的服务条款、版权要求以及相关法律法规。

---

## ✨ 核心功能与优化改进

- **全生态 Pixiv 节点支持**:
  - **图片 CDN**: `i.pximg.net`、`s.pximg.net`、`imp.pixiv.net`、`source.pixiv.net`。
  - **App API**: `app-api.pixiv.net` (插画检索、排行榜、漫画、小说、动态、评论等)。
  - **OAuth 鉴权**: `oauth.secure.pixiv.net`、`accounts.pixiv.net` (支持登录认证与 Token 刷新)。
- **动图 Ugoira 原生兼容**:
  支持 Pixiv 动画压缩包格式（`.zip`），允许直接下载播放 Ugoira 序列帧动图。
- **断点续传与 Range 分片支持**:
  透传 `Range` 请求头，支持 206 Partial Content 分片加速与大图断点续传。
- **全 HTTP 方法支持**:
  针对 API 节点全面支持 `GET`、`POST`、`PUT`、`DELETE`、`PATCH` 与 `OPTIONS`，支持收藏、点赞、关注等完整交互；图片节点仍保持安全的 `GET`/`HEAD` 限制。
- **差异化智能缓存策略**:
  - 图片静态资源默认在 Cloudflare 边缘及浏览器端长效缓存 30 天（`immutable`），大幅节约带宽与提升加载速度。
  - 携带身份认证与动态数据的 API 请求默认不进行公开 CDN 缓存（`no-store`），确保用户隐私与数据实时性。
- **请求头清洗与防盗链伪造**:
  图片请求自动注入 `Referer: https://www.pixiv.net/` 规避 403 防盗链；API 请求完整保留客户端 App 特征头（`Authorization`、`App-OS`、`X-Client-Time`、`X-Client-Hash` 等）。
- **全跨域 (CORS) 开启**:
  完整支持 `Access-Control-Allow-Origin: *`，方便浏览器端 Web 应用直接调用。

---

## 📌 URL 路由与用法

将下面的 `<WORKER_HOST>` 替换为你的 Worker 域名或绑定域名，例如 `https://pixiv-proxy.example.workers.dev`。

### 1. 完整域名模式 (推荐用于 PixEz 等客户端)

在 URL 路径第一段显式指定 Pixiv 目标域名：

#### 图片请求:
```text
https://<WORKER_HOST>/i.pximg.net/img-original/img/2026/01/01/00/00/00/12345678_p0.jpg
https://<WORKER_HOST>/i.pximg.net/img-zip-ugoira/img/2026/01/01/00/00/00/12345678_ugoira600x600.zip
https://<WORKER_HOST>/s.pximg.net/common/images/no_profile.png
```

#### API 请求:
```text
https://<WORKER_HOST>/app-api.pixiv.net/v1/illust/detail?illust_id=12345678
https://<WORKER_HOST>/app-api.pixiv.net/v2/illust/ranking?mode=day
```

#### OAuth 鉴权请求:
```text
https://<WORKER_HOST>/oauth.secure.pixiv.net/auth/token
```

---

### 2. 简写模式 (直接访问常用资源)

#### 图片简写 (默认转发至 `i.pximg.net`):
```text
https://<WORKER_HOST>/img-original/img/2026/01/01/00/00/00/12345678_p0.jpg
https://<WORKER_HOST>/img-master/img/2026/01/01/00/00/00/12345678_p0_master1200.jpg
https://<WORKER_HOST>/img-zip-ugoira/img/2026/01/01/00/00/00/12345678_ugoira600x600.zip
```
支持前缀：`img-original`、`img-master`、`c`、`custom-thumb`、`novel-img`、`img-zip-ugoira`、`user-profile`、`novel-cover`。

#### API 简写 (默认转发至 `app-api.pixiv.net`):
```text
https://<WORKER_HOST>/v1/illust/detail?illust_id=12345678
https://<WORKER_HOST>/v2/illust/ranking?mode=day
https://<WORKER_HOST>/v1/search/illust?word=初音未来
```

#### 登录认证简写 (默认转发至 `oauth.secure.pixiv.net`):
```text
https://<WORKER_HOST>/auth/token
```

---

## 📱 PixEz Flutter 客户端集成配置

在 [PixEz Flutter](https://github.com/Notsfsssf/pixez-flutter) 中：

1. 进入 **设置** > **网络设置**。
2. 将 **图片代理 / 镜像域名** 设为：
   ```text
   <WORKER_HOST>/i.pximg.net
   ```
   或直接开启自定义反代地址。
3. （可选）如果客户端支持自定义 API 域名，可将 `app-api.pixiv.net` 的代理主机指向：
   ```text
   <WORKER_HOST>/app-api.pixiv.net
   ```

---

## 💻 本地开发与测试

```bash
# 安装依赖
npm install

# 运行自动化单元测试
npm test -- --run

# 启动本地开发服务 (默认端口 8787)
npm run dev
```

---

## 🚀 部署到 Cloudflare Workers

确保已使用 Wrangler 登录 Cloudflare（`npx wrangler login`）：

```bash
# 部署至生产环境
npx wrangler deploy
```

部署配置位于 [`wrangler.jsonc`](./wrangler.jsonc)，入口逻辑位于 [`src/index.js`](./src/index.js)。
