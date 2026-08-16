# Pixiv Proxy

基于 Cloudflare Workers 的 Pixiv 图片反向代理。它会将请求转发到指定的 Pixiv 图片域名，并通过 CORS 和 CDN 缓存让浏览器可以直接加载图片。

> 仅用于个人学习和合法用途。请遵守 Pixiv 的服务条款、版权要求以及相关法律法规。

## 功能

- 支持完整域名模式和简写模式。
- 只允许访问预设的 Pixiv 域名和图片扩展名。
- 支持 `GET`、`HEAD` 和 CORS `OPTIONS` 请求。
- 上游响应保持流式传输，不会将整张图片读入 Worker 内存。
- 2xx 图片响应默认缓存 30 天，错误响应不缓存。
- 上游重定向最多跟随 3 次，且目标必须仍在白名单域名内。
- 对路径穿越、编码分隔符和非图片响应进行校验。

## URL 用法

将下面的 `<WORKER_HOST>` 替换为你的 Worker 主机名，例如 `pixiv-proxy.example.workers.dev`。

### 完整域名模式

URL 的第一段是 Pixiv 图片域名：

```text
https://<WORKER_HOST>/i.pximg.net/img-original/img/2026/01/01/00/00/00/12345678_p0.jpg
```

支持的完整模式域名：

- `i.pximg.net`
- `s.pximg.net`
- `imp.pixiv.net`
- `source.pixiv.net`

### 简写模式

简写模式默认转发到 `i.pximg.net`：

```text
https://<WORKER_HOST>/img-original/img/2026/01/01/00/00/00/12345678_p0.jpg
```

允许的路径前缀：

- `img-original`
- `img-master`
- `c`
- `custom-thumb`
- `novel-img`

允许的图片扩展名：`.jpg`、`.jpeg`、`.png`、`.gif`、`.webp`、`.avif`、`.bmp`。

查询参数会原样转发到上游。如果同一图片 URL 携带大量无关参数，可能降低缓存命中率。

## 本地开发

需要 Node.js 和 pnpm。

```bash
pnpm install
pnpm dev
```

启动后访问：

```text
http://localhost:8787/
```

也可以直接测试代理地址：

```bash
curl -I "http://localhost:8787/img-original/img/2026/01/01/example.jpg"
```

## 测试

```bash
pnpm test -- --run
```

测试覆盖根路径、CORS 预检、方法限制、域名限制、短路径限制、编码路径校验和扩展名校验。

如果本地出现类似下面的错误：

```text
The latest compatibility date supported by the installed Cloudflare Workers Runtime is "2026-03-10"
```

说明本地 Vitest/Miniflare 运行时版本落后于 `wrangler.jsonc` 中的兼容日期。请更新 `@cloudflare/vitest-pool-workers`、Wrangler 及锁文件后再运行测试；不要为了绕过本地测试而直接降低生产兼容日期。

## 部署

首次使用 Wrangler 时先登录 Cloudflare：

```bash
pnpm exec wrangler login
```

部署 Worker：

```bash
pnpm deploy
```

部署配置位于 [`wrangler.jsonc`](./wrangler.jsonc)，入口文件是 [`src/index.js`](./src/index.js)。

## 配置说明

当前 Worker 不需要 KV、R2、D1 或其他绑定。主要配置如下：

- `compatibility_date`：Worker 使用的 Cloudflare Runtime 兼容日期。
- `observability.enabled`：启用 Workers Logs。
- `observability.head_sampling_rate`：日志采样率，当前为 `0.1`。
- 图片缓存时间：源码中的 `CACHE_TTL`，当前为 30 天。

如果修改了白名单域名、路径前缀、扩展名或缓存时间，请同步更新测试和本文档。

## 安全注意事项

这是一个公开图片代理，默认没有用户认证、访问令牌或速率限制。部署到公网前建议至少配置以下一项：

- Cloudflare WAF 或 Rate Limiting。
- Cloudflare Access。
- 自己的访问令牌校验。
- 仅绑定到个人使用的域名或私有网络入口。

不要在 URL 查询参数中放置密钥、Cookie 或其他敏感信息。Worker 只会向白名单 Pixiv 域名发起请求，但公网代理仍可能被滥用来消耗流量和请求额度。

## 项目结构

```text
.
├── src/index.js          # Worker 入口和代理逻辑
├── test/index.spec.js    # Vitest / Workers 测试
├── wrangler.jsonc        # Wrangler 配置
├── vitest.config.js      # Workers 测试配置
└── package.json          # 开发、测试和部署命令
```

## 相关文档

- [Cloudflare Workers 入门](https://developers.cloudflare.com/workers/get-started/guide/)
- [Fetch Handler](https://developers.cloudflare.com/workers/runtime-apis/handlers/fetch/)
- [Workers 最佳实践](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)
- [Wrangler 命令](https://developers.cloudflare.com/workers/wrangler/commands/)
