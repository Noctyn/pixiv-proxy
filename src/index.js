const DEFAULT_HOST = "i.pximg.net";
const REFERER = "https://www.pixiv.net/";
const CACHE_TTL = 60 * 60 * 24 * 30;
const MAX_REDIRECTS = 3;

const ALLOWED_METHODS = new Set(["GET", "HEAD"]);
const ALLOWED_HOSTS = new Set([
	"i.pximg.net",
	"s.pximg.net",
	"imp.pixiv.net",
	"source.pixiv.net",
]);
const SHORT_PATH_PREFIXES = new Set([
	"img-original",
	"img-master",
	"c",
	"custom-thumb",
	"novel-img",
]);
const ALLOWED_EXTENSIONS = [
	".jpg",
	".jpeg",
	".png",
	".gif",
	".webp",
	".avif",
	".bmp",
];
const UPSTREAM_HEADERS = new Headers({
	Referer: REFERER,
	"User-Agent":
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
	Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
});

export default {
	async fetch(request) {
		return handleRequest(request);
	},
};

async function handleRequest(request) {
	if (request.method === "OPTIONS") {
		return new Response(null, { status: 204, headers: corsHeaders() });
	}

	if (!ALLOWED_METHODS.has(request.method)) {
		return methodNotAllowedResponse();
	}

	const requestUrl = new URL(request.url);
	if (requestUrl.pathname === "/") {
		return infoResponse();
	}

	const target = resolveTarget(requestUrl);
	if (target instanceof Response) {
		return target;
	}

	const targetUrl = new URL(`https://${target.host}/${target.path}`);
	targetUrl.search = requestUrl.search;

	try {
		const upstreamResponse = await fetchUpstream(targetUrl, request.method);

		if (!upstreamResponse.ok) {
			await cancelBody(upstreamResponse);
			return upstreamErrorResponse(upstreamResponse.status);
		}

		if (!isImageResponse(upstreamResponse)) {
			await cancelBody(upstreamResponse);
			return errorResponse("Upstream returned a non-image response", 502);
		}

		const response = new Response(upstreamResponse.body, upstreamResponse);
		for (const [name, value] of Object.entries(corsHeaders())) {
			response.headers.set(name, value);
		}
		response.headers.set(
			"Cache-Control",
			`public, max-age=${CACHE_TTL}, immutable`,
		);
		response.headers.set("CDN-Cache-Control", `public, max-age=${CACHE_TTL}`);
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

function resolveTarget(requestUrl) {
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

	if (ALLOWED_HOSTS.has(firstPart)) {
		host = firstPart;
		path = pathParts.slice(1).join("/");
	} else if (SHORT_PATH_PREFIXES.has(firstPart)) {
		host = DEFAULT_HOST;
		path = pathParts.join("/");
	} else if (firstPart.includes(".")) {
		return errorResponse("Blocked host", 403);
	} else {
		return errorResponse("Unsupported Pixiv path", 403);
	}

	if (!path) {
		return errorResponse("Missing image path", 400);
	}

	if (!hasAllowedExtension(path)) {
		return errorResponse("Unsupported file type", 403);
	}

	return { host, path };
}

async function fetchUpstream(initialUrl, method) {
	let targetUrl = initialUrl;

	for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
		const response = await fetch(targetUrl, {
			method,
			headers: UPSTREAM_HEADERS,
			redirect: "manual",
			cf: {
				cacheEverything: true,
				cacheTtlByStatus: {
					"200-299": CACHE_TTL,
					"300-399": -1,
					"400-499": -1,
					"500-599": -1,
				},
			},
		});

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
	return (
		url.protocol === "https:" &&
		!url.username &&
		!url.password &&
		ALLOWED_HOSTS.has(url.hostname.toLowerCase()) &&
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

function hasAllowedExtension(pathname) {
	const decodedPathname = decodePathname(pathname);
	if (!decodedPathname) {
		return false;
	}

	const lowerPathname = decodedPathname.toLowerCase();
	return ALLOWED_EXTENSIONS.some((extension) =>
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

function isImageResponse(response) {
	return /^image\/(?:avif|bmp|gif|jpeg|png|webp)(?:;|$)/i.test(
		response.headers.get("Content-Type") ?? "",
	);
}

async function cancelBody(response) {
	if (!response.body) {
		return;
	}

	try {
		await response.body.cancel();
	} catch {
		// The response is already being discarded; there is nothing useful to recover.
	}
}

function corsHeaders() {
	return {
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
		"Access-Control-Allow-Headers": "Accept, Range",
		"Access-Control-Max-Age": "86400",
	};
}

function infoResponse() {
	return new Response(
		"Pixiv Proxy is running.\n\n" +
			"Full:  https://your-domain.com/i.pximg.net/img-master/...\n" +
			"Short: https://your-domain.com/img-original/img/2026/...\n",
		{
			headers: {
				"Content-Type": "text/plain; charset=utf-8",
				"Cache-Control": "no-store",
				...corsHeaders(),
			},
		},
	);
}

function methodNotAllowedResponse() {
	return new Response("Method not allowed", {
		status: 405,
		headers: {
			Allow: "GET, HEAD, OPTIONS",
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
