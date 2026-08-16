// cloudflare-pixiv-proxy-worker-v3.js

const DEFAULT_HOST = "i.pximg.net";
const REFERER = "https://www.pixiv.net/";

const ALLOWED_HOSTS = new Set([
	"i.pximg.net",
	"s.pximg.net",
	"imp.pixiv.net",
	"source.pixiv.net",
]);

// 常见 Pixiv 路径前缀（简写模式）
const PIXIV_PATH_PREFIXES = [
	"img-original",
	"img-master",
	"c/",
	"custom-thumb",
	"novel-img",
];

// 只允许这些后缀（可按需增减）
const ALLOWED_EXTENSIONS = new Set([
	".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif", ".bmp"
]);

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

addEventListener("fetch", (event) => {
	event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
	// 处理 CORS 预检
	if (request.method === "OPTIONS") {
		return new Response(null, {
			status: 204,
			headers: corsHeaders(),
		});
	}

	const url = new URL(request.url);

	// 根路径说明
	if (url.pathname === "/" || url.pathname === "") {
		return new Response(
			"🎨 Pixiv Proxy is running.\n\n" +
			"Usage 1 (Full):   https://your-domain.com/i.pximg.net/img-master/...\n" +
			"Usage 2 (Short):  https://your-domain.com/img-original/img/2026/...\n\n" +
			"Note: For personal use only.",
			{
				status: 200,
				headers: { "Content-Type": "text/plain; charset=utf-8", ...corsHeaders() },
			}
		);
	}

	const pathParts = url.pathname.split("/").filter(Boolean);
	if (pathParts.length === 0) {
		return errorResponse("Invalid URL", 400);
	}

	let targetHost = "";
	let targetPath = "";

	const firstPart = pathParts[0];

	// 完整模式：第一段是白名单域名
	if (ALLOWED_HOSTS.has(firstPart)) {
		targetHost = firstPart;
		targetPath = pathParts.slice(1).join("/");
	}
	// 简写模式：匹配常见前缀
	else if (PIXIV_PATH_PREFIXES.some((p) => firstPart === p || firstPart.startsWith(p))) {
		targetHost = DEFAULT_HOST;
		targetPath = pathParts.join("/");
	}
	// 兜底：如果第一段带点且不在白名单 → 拒绝
	else if (firstPart.includes(".")) {
		return errorResponse(`Blocked host: ${firstPart}`, 403);
	}
	// 其他情况按简写处理
	else {
		targetHost = DEFAULT_HOST;
		targetPath = pathParts.join("/");
	}

	if (!targetPath) {
		return errorResponse("Missing image path", 400);
	}

	// 安全检查：拒绝路径穿越
	if (targetPath.includes("..") || targetPath.includes("//")) {
		return errorResponse("Invalid path", 400);
	}

	// 后缀白名单（可选但强烈建议）
	const lowerPath = targetPath.toLowerCase();
	const hasValidExt = [...ALLOWED_EXTENSIONS].some((ext) => lowerPath.endsWith(ext));
	if (!hasValidExt) {
		return errorResponse("Unsupported file type", 403);
	}

	const targetUrl = `https://${targetHost}/${targetPath}${url.search}`;
	const clientIP = request.headers.get("CF-Connecting-IP") || "Unknown";

	console.log(`[IP: ${clientIP}] → ${targetUrl}`);

	const headers = new Headers({
		Referer: REFERER,
		"User-Agent": UA,
		Accept: "image/webp,image/apng,image/*,*/*;q=0.8",
	});

	try {
		const response = await fetch(targetUrl, {
			headers,
			cf: {
				cacheEverything: true,
				cacheTtl: 86400 * 30, // 30 天
			},
		});

		if (!response.ok) {
			// 生产环境不要返回完整 URL
			return errorResponse(`Upstream error: ${response.status}`, response.status);
		}

		// 构建响应
		const newResponse = new Response(response.body, response);

		// CORS
		Object.entries(corsHeaders()).forEach(([k, v]) => newResponse.headers.set(k, v));

		// 缓存头
		newResponse.headers.set("Cache-Control", "public, max-age=2592000, immutable");
		newResponse.headers.set("CDN-Cache-Control", "public, max-age=2592000");

		// 清理不需要的头
		newResponse.headers.delete("content-security-policy");
		newResponse.headers.delete("x-frame-options");
		newResponse.headers.delete("set-cookie");

		return newResponse;
	} catch (e) {
		console.error("Fetch error:", e.message);
		return errorResponse("Proxy fetch failed", 502);
	}
}

function corsHeaders() {
	return {
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
		"Access-Control-Allow-Headers": "*",
		"Access-Control-Max-Age": "86400",
	};
}

function errorResponse(message, status = 400) {
	return new Response(message, {
		status,
		headers: {
			"Content-Type": "text/plain; charset=utf-8",
			...corsHeaders(),
		},
	});
}
