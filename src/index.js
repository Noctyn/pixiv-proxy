const DEFAULT_HOST = "i.pximg.net";
const REFERER = "https://www.pixiv.net/";
const CACHE_TTL = 60 * 60 * 24 * 30;
const MAX_REDIRECTS = 3;

const DEFAULT_IMAGE_USER_AGENT =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const ALLOWED_IMAGE_METHODS = {
	GET: true,
	HEAD: true,
};

const ALLOWED_API_METHODS = {
	GET: true,
	HEAD: true,
	POST: true,
	PUT: true,
	DELETE: true,
	PATCH: true,
};

const IMAGE_HOSTS = {
	"i.pximg.net": true,
	"s.pximg.net": true,
	"imp.pixiv.net": true,
	"source.pixiv.net": true,
};

const API_HOSTS = {
	"app-api.pixiv.net": true,
	"oauth.secure.pixiv.net": true,
	"accounts.pixiv.net": true,
	"www.pixiv.net": true,
	"touch.pixiv.net": true,
};

const SHORT_PATH_IMAGE_PREFIXES = {
	"img-original": true,
	"img-master": true,
	c: true,
	"custom-thumb": true,
	"novel-img": true,
	"img-zip-ugoira": true,
	"user-profile": true,
	"novel-cover": true,
};

const SHORT_PATH_API_PREFIXES = {
	v1: true,
	v2: true,
	v3: true,
	web: true,
	api: true,
};

const SHORT_PATH_OAUTH_PREFIXES = {
	auth: true,
};

const ALLOWED_IMAGE_EXTENSIONS = [
	".jpg",
	".jpeg",
	".png",
	".gif",
	".webp",
	".avif",
	".bmp",
	".zip", // Pixiv Ugoira (动图压缩包)
];

const HOP_BY_HOP_HEADERS = {
	"cf-connecting-ip": true,
	"cf-ipcountry": true,
	"cf-ray": true,
	"cf-visitor": true,
	"cf-worker": true,
	"x-forwarded-for": true,
	"x-forwarded-proto": true,
	"x-real-ip": true,
	connection: true,
	"keep-alive": true,
	"proxy-authenticate": true,
	"proxy-authorization": true,
	te: true,
	trailer: true,
	"transfer-encoding": true,
	upgrade: true,
	host: true,
};

export default {
	async fetch(request) {
		return handleRequest(request);
	},
};

async function handleRequest(request) {
	const requestUrl = new URL(request.url);
	const isApi = isApiPath(requestUrl.pathname);

	if (request.method === "OPTIONS") {
		return new Response(null, { status: 204, headers: corsHeaders(isApi) });
	}

	if (requestUrl.pathname === "/" || requestUrl.pathname === "") {
		return infoResponse();
	}

	const target = resolveTarget(requestUrl, request.method);
	if (target instanceof Response) {
		return target;
	}

	const targetUrl = new URL(`https://${target.host}/${target.path}`);
	targetUrl.search = requestUrl.search;

	try {
		const upstreamResponse = await fetchUpstream(
			targetUrl,
			request,
			target.isImageHost,
		);

		if (!upstreamResponse.ok && upstreamResponse.status !== 206) {
			await cancelBody(upstreamResponse);
			return upstreamErrorResponse(upstreamResponse.status);
		}

		if (target.isImageHost && !isAllowedMediaResponse(upstreamResponse)) {
			await cancelBody(upstreamResponse);
			return errorResponse("Upstream returned a non-image response", 502);
		}

		const response = new Response(upstreamResponse.body, upstreamResponse);
		for (const [name, value] of Object.entries(corsHeaders(isApi))) {
			response.headers.set(name, value);
		}

		if (target.isImageHost) {
			response.headers.set(
				"Cache-Control",
				`public, max-age=${CACHE_TTL}, immutable`,
			);
			response.headers.set("CDN-Cache-Control", `public, max-age=${CACHE_TTL}`);
		} else {
			// API and OAuth responses must not be cached by public CDN
			if (!response.headers.has("Cache-Control")) {
				response.headers.set(
					"Cache-Control",
					"private, no-cache, no-store, must-revalidate",
				);
			}
		}

		response.headers.set("Cross-Origin-Resource-Policy", "cross-origin");
		response.headers.set("X-Content-Type-Options", "nosniff");
		response.headers.delete("content-security-policy");
		response.headers.delete("x-frame-options");
		response.headers.delete("set-cookie");

		return response;
	} catch (error) {
		console.error(
			JSON.stringify({
				event: "pixiv_proxy_fetch_failed",
				message: error instanceof Error ? error.message : "Unknown error",
			}),
		);
		return errorResponse("Proxy fetch failed", 502);
	}
}

function resolveTarget(requestUrl, method) {
	if (!isSafePathname(requestUrl.pathname)) {
		return errorResponse("Invalid path", 400);
	}

	const pathParts = requestUrl.pathname.split("/").filter(Boolean);
	if (pathParts.length === 0) {
		return errorResponse("Missing image path", 400);
	}

	const firstPart = pathParts[0].toLowerCase();
	let host;
	let path;
	let isImageHost = false;

	if (IMAGE_HOSTS[firstPart]) {
		host = firstPart;
		path = pathParts.slice(1).join("/");
		isImageHost = true;
	} else if (API_HOSTS[firstPart]) {
		host = firstPart;
		path = pathParts.slice(1).join("/");
		isImageHost = false;
	} else if (SHORT_PATH_IMAGE_PREFIXES[firstPart]) {
		host = DEFAULT_HOST;
		path = pathParts.join("/");
		isImageHost = true;
	} else if (SHORT_PATH_API_PREFIXES[firstPart]) {
		host = "app-api.pixiv.net";
		path = pathParts.join("/");
		isImageHost = false;
	} else if (SHORT_PATH_OAUTH_PREFIXES[firstPart]) {
		host = "oauth.secure.pixiv.net";
		path = pathParts.join("/");
		isImageHost = false;
	} else if (firstPart.includes(".")) {
		return errorResponse("Blocked host", 403);
	} else {
		return errorResponse("Unsupported Pixiv path", 403);
	}

	if (!path) {
		return errorResponse("Missing image path", 400);
	}

	// Method validation based on target category
	if (isImageHost) {
		if (!ALLOWED_IMAGE_METHODS[method]) {
			return methodNotAllowedResponse("GET, HEAD, OPTIONS");
		}
		if (!hasAllowedImageExtension(path)) {
			return errorResponse("Unsupported file type", 403);
		}
	} else {
		if (!ALLOWED_API_METHODS[method]) {
			return methodNotAllowedResponse(
				"GET, HEAD, POST, PUT, DELETE, PATCH, OPTIONS",
			);
		}
	}

	return { host, path, isImageHost };
}

function buildUpstreamHeaders(request, isImageHost) {
	const headers = new Headers();

	for (const [key, value] of request.headers.entries()) {
		const lowerKey = key.toLowerCase();
		if (!HOP_BY_HOP_HEADERS[lowerKey]) {
			headers.set(key, value);
		}
	}

	if (isImageHost) {
		headers.set("Referer", REFERER);
		const currentUa = headers.get("user-agent");
		if (!currentUa) {
			headers.set("User-Agent", DEFAULT_IMAGE_USER_AGENT);
		}
		if (!headers.has("Accept")) {
			headers.set(
				"Accept",
				"image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
			);
		}
	}

	return headers;
}

async function fetchUpstream(initialUrl, request, isImageHost) {
	let targetUrl = initialUrl;
	const upstreamHeaders = buildUpstreamHeaders(request, isImageHost);

	let requestBody = null;
	if (request.method !== "GET" && request.method !== "HEAD") {
		requestBody = request.body;
	}

	for (
		let redirectCount = 0;
		redirectCount <= MAX_REDIRECTS;
		redirectCount += 1
	) {
		const fetchInit = {
			method: request.method,
			headers: upstreamHeaders,
			body: requestBody,
			redirect: "manual",
		};

		if (isImageHost) {
			fetchInit.cf = {
				cacheEverything: true,
				cacheTtlByStatus: {
					"200-299": CACHE_TTL,
					"300-399": -1,
					"400-499": -1,
					"500-599": -1,
				},
			};
		}

		const response = await fetch(targetUrl, fetchInit);

		if (response.status < 300 || response.status > 399) {
			return response;
		}

		const location = response.headers.get("Location");
		await cancelBody(response);
		if (!location) {
			throw new Error("Upstream redirect is missing a Location header");
		}

		const nextUrl = new URL(location, targetUrl);
		if (!isAllowedRedirect(nextUrl)) {
			throw new Error("Upstream redirect target is not allowed");
		}

		targetUrl = nextUrl;
	}

	throw new Error("Upstream exceeded the redirect limit");
}

function isAllowedRedirect(url) {
	const host = url.hostname.toLowerCase();
	return (
		url.protocol === "https:" &&
		!url.username &&
		!url.password &&
		Boolean(IMAGE_HOSTS[host] || API_HOSTS[host]) &&
		isSafePathname(url.pathname)
	);
}

function isSafePathname(pathname) {
	if (!pathname.startsWith("/") || pathname.includes("//")) {
		return false;
	}

	const decodedPathname = decodePathname(pathname);
	if (!decodedPathname || /%(?:2f|5c)/i.test(decodedPathname)) {
		return false;
	}

	return (
		!decodedPathname.includes("\\") &&
		!decodedPathname.includes("//") &&
		!decodedPathname.split("/").some((part) => part === "." || part === "..")
	);
}

function hasAllowedImageExtension(pathname) {
	const decodedPathname = decodePathname(pathname);
	if (!decodedPathname) {
		return false;
	}

	const lowerPathname = decodedPathname.toLowerCase();
	return ALLOWED_IMAGE_EXTENSIONS.some((extension) =>
		lowerPathname.endsWith(extension),
	);
}

function decodePathname(pathname) {
	let decodedPathname = pathname;

	try {
		for (let index = 0; index < 3; index += 1) {
			const nextPathname = decodeURIComponent(decodedPathname);
			if (nextPathname === decodedPathname) {
				break;
			}
			decodedPathname = nextPathname;
		}
	} catch {
		return null;
	}

	return decodedPathname;
}

function isAllowedMediaResponse(response) {
	const contentType = (response.headers.get("Content-Type") ?? "").toLowerCase();
	return (
		/^image\/(?:avif|bmp|gif|jpeg|png|webp)(?:;|$)/.test(contentType) ||
		/^(?:application\/zip|application\/octet-stream|application\/x-zip-compressed)(?:;|$)/.test(
			contentType,
		)
	);
}

async function cancelBody(response) {
	if (!response.body) {
		return;
	}

	try {
		await response.body.cancel();
	} catch {
		// Response is discarded
	}
}

function corsHeaders(isApi = false) {
	return {
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Methods": isApi
			? "GET, HEAD, POST, PUT, DELETE, PATCH, OPTIONS"
			: "GET, HEAD, OPTIONS",
		"Access-Control-Allow-Headers": "*",
		"Access-Control-Expose-Headers":
			"Content-Length, Content-Range, Content-Type, ETag, Cache-Control",
		"Access-Control-Max-Age": "86400",
	};
}

function isApiPath(pathname) {
	const first = pathname.split("/").filter(Boolean)[0]?.toLowerCase();
	return Boolean(
		API_HOSTS[first] ||
			SHORT_PATH_API_PREFIXES[first] ||
			SHORT_PATH_OAUTH_PREFIXES[first],
	);
}

function infoResponse() {
	return new Response(
		"Pixiv Proxy is running.\n\n" +
			"Supported domains:\n" +
			"  - Images: i.pximg.net, s.pximg.net, imp.pixiv.net, source.pixiv.net (supports .jpg, .png, .gif, .webp, .zip)\n" +
			"  - App API: app-api.pixiv.net (v1, v2, v3)\n" +
			"  - OAuth: oauth.secure.pixiv.net, accounts.pixiv.net\n\n" +
			"Usage examples:\n" +
			"  - Full Image:  https://your-domain.com/i.pximg.net/img-original/...\n" +
			"  - Short Image: https://your-domain.com/img-original/img/2026/...\n" +
			"  - Ugoira Zip:  https://your-domain.com/img-zip-ugoira/...\n" +
			"  - Full API:    https://your-domain.com/app-api.pixiv.net/v1/illust/detail?illust_id=...\n" +
			"  - Short API:   https://your-domain.com/v1/illust/detail?illust_id=...\n" +
			"  - OAuth Token: https://your-domain.com/auth/token\n",
		{
			headers: {
				"Content-Type": "text/plain; charset=utf-8",
				"Cache-Control": "no-store",
				...corsHeaders(),
			},
		},
	);
}

function methodNotAllowedResponse(allowed = "GET, HEAD, OPTIONS") {
	return new Response("Method not allowed", {
		status: 405,
		headers: {
			Allow: allowed,
			"Cache-Control": "no-store",
			...corsHeaders(),
		},
	});
}

function upstreamErrorResponse(status) {
	const responseStatus = status >= 400 && status <= 599 ? status : 502;
	return errorResponse(`Upstream error: ${status}`, responseStatus);
}

function errorResponse(message, status = 400) {
	return new Response(message, {
		status,
		headers: {
			"Content-Type": "text/plain; charset=utf-8",
			"Cache-Control": "no-store",
			...corsHeaders(),
		},
	});
}
