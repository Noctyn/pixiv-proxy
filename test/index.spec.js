import {
	createExecutionContext,
	env,
	SELF,
	waitOnExecutionContext,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src/index.js";

async function unitFetch(path, init) {
	const ctx = createExecutionContext();
	const response = await worker.fetch(
		new Request(`https://example.com${path}`, init),
		env,
		ctx,
	);
	await waitOnExecutionContext(ctx);
	return response;
}

describe("Pixiv proxy", () => {
	it("shows usage information at the root path", async () => {
		const response = await unitFetch("/");

		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(await response.text()).toContain("Pixiv Proxy is running.");
	});

	it("handles CORS preflight requests", async () => {
		const response = await unitFetch("/img-original/img/2026/example.jpg", {
			method: "OPTIONS",
		});

		expect(response.status).toBe(204);
		expect(response.headers.get("access-control-allow-methods")).toBe(
			"GET, HEAD, OPTIONS",
		);
	});

	it("rejects unsupported methods", async () => {
		const response = await unitFetch("/img-original/img/2026/example.jpg", {
			method: "POST",
		});

		expect(response.status).toBe(405);
		expect(response.headers.get("allow")).toBe("GET, HEAD, OPTIONS");
	});

	it("rejects unapproved upstream hosts", async () => {
		const response = await unitFetch("/example.com/image.jpg");

		expect(response.status).toBe(403);
		expect(await response.text()).toBe("Blocked host");
	});

	it("rejects paths outside the short-link allowlist", async () => {
		const response = await unitFetch("/unrecognized/image.jpg");

		expect(response.status).toBe(403);
		expect(await response.text()).toBe("Unsupported Pixiv path");
	});

	it("rejects nested encoded path separators", async () => {
		const response = await unitFetch(
			"/img-original/%252fprivate/example.jpg",
		);

		expect(response.status).toBe(400);
		expect(await response.text()).toBe("Invalid path");
	});

	it("rejects files with unsupported extensions", async () => {
		const response = await unitFetch("/img-original/img/2026/example.txt");

		expect(response.status).toBe(403);
		expect(await response.text()).toBe("Unsupported file type");
	});

	it("serves the root response through the deployed Worker", async () => {
		const response = await SELF.fetch("https://example.com/");

		expect(response.status).toBe(200);
		expect(await response.text()).toContain("Pixiv Proxy is running.");
	});
});
