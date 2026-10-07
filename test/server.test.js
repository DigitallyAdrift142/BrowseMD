"use strict";
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { createServer } = require("../server.js");

let base, server;
test.before(async () => {
	server = createServer(path.join(__dirname, "..", "site"));
	await new Promise((r) => server.listen(0, "127.0.0.1", r));
	base = "http://127.0.0.1:" + server.address().port;
});
test.after(() => server.close());

const get = (p, accept) => fetch(base + p, { headers: { Accept: accept || "*/*" }, redirect: "manual" });
const HTML = "text/html,application/xhtml+xml";

test("browsers navigating to a document get the app", async () => {
	for (const p of ["/", "/index.md", "/2026/10/06.md", "/archive/"]) {
		const res = await get(p, HTML);
		assert.strictEqual(res.status, 200, p);
		assert.match(await res.text(), /<main id="page"/);
	}
});

test("everyone else gets the Markdown", async () => {
	const res = await get("/2026/10/06.md");
	assert.strictEqual(res.status, 200);
	assert.match(res.headers.get("content-type"), /text\/markdown/);
	assert.match(await res.text(), /^---\n/);
	const raw = await get("/index.md?raw", HTML);
	assert.match(await raw.text(), /^# Scripting News/);
	const dir = await get("/");
	assert.match(await dir.text(), /^# Scripting News/);
});

test("missing documents are 404 both ways", async () => {
	assert.strictEqual((await get("/nope.md", HTML)).status, 404);
	assert.strictEqual((await get("/nope.md")).status, 404);
});

test("directories without a trailing slash redirect", async () => {
	const res = await get("/archive", HTML);
	assert.strictEqual(res.status, 301);
	assert.strictEqual(res.headers.get("location"), "/archive/");
});

test("static files and app files", async () => {
	const img = await get("/images/photo.svg");
	assert.strictEqual(img.status, 200);
	assert.strictEqual(img.headers.get("content-type"), "image/svg+xml");
	assert.strictEqual((await get("/_mb/browser.js")).status, 200);
	assert.strictEqual((await get("/_mb/lib/parseMarkdown.js")).status, 200);
});

test("paths can't escape the site", async () => {
	for (const p of ["/../server.js", "/%2e%2e/server.js", "/.git/config", "/_mb/../server.js", "/_mb/lib/../../server.js", "/..%5cserver.js"]) {
		const res = await get(p);
		assert.notStrictEqual(res.status, 200, p);
		if (res.status === 200) assert.doesNotMatch(await res.text(), /createServer/, p);
	}
});

test("unchanged files revalidate with 304", async () => {
	const first = await get("/about.md");
	const etag = first.headers.get("etag");
	const second = await fetch(base + "/about.md", { headers: { "If-None-Match": etag } });
	assert.strictEqual(second.status, 304);
});
