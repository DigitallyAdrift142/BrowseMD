#!/usr/bin/env node
// The Markdown Browser server. No dependencies, no database: the filesystem is the database.
//
//   browsemd [siteFolder] [--port 1994] [--host 127.0.0.1]
//
// Requests for a .md file (or a directory, meaning its index.md):
//   - from a web browser navigating (Accept: text/html)  -> the browser app
//   - from anything else, or with ?raw                    -> the Markdown itself
// So every document has one stable, bookmarkable URL that works for both people and programs.
//
// Everything else in the site folder is served as a static file.

"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const APP_DIR = path.join(__dirname, "client");
const LIB_DIR = path.join(__dirname, "lib");
const SHELL = path.join(APP_DIR, "index.html");

const TYPES = {
	".md": "text/markdown; charset=utf-8",
	".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".txt": "text/plain; charset=utf-8",
	".xml": "application/xml; charset=utf-8",
	".opml": "text/x-opml; charset=utf-8",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".png": "image/png",
	".gif": "image/gif",
	".webp": "image/webp",
	".avif": "image/avif",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".pdf": "application/pdf",
	".mp3": "audio/mpeg",
	".mp4": "video/mp4",
	".woff2": "font/woff2"
};

// The app shell only runs our own scripts. Documents are rendered with escaping,
// but this makes sure that even a renderer bug can't run script from a document.
const SHELL_CSP = "default-src 'self'; img-src * data: blob:; media-src *; script-src 'self'; " +
	"style-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";

function parseArgs(argv) {
	const opts = { port: Number(process.env.PORT) || 1994, host: process.env.HOST || "127.0.0.1", site: null };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--port" || a === "-p") opts.port = Number(argv[++i]);
		else if (a === "--host") opts.host = argv[++i];
		else if (a === "--help" || a === "-h") opts.help = true;
		else if (a === "--version" || a === "-v") opts.version = true;
		else if (!a.startsWith("-")) opts.site = a;
		else throw new Error("Unknown option: " + a);
	}
	return opts;
}

// Default site: the current folder if it has an index.md, otherwise the bundled sample.
function chooseSite(arg) {
	if (arg) return path.resolve(arg);
	if (fs.existsSync(path.join(process.cwd(), "index.md"))) return process.cwd();
	return path.join(__dirname, "site");
}

async function statOrNull(file) {
	try { return await fs.promises.stat(file); }
	catch (err) { return null; }
}

function send(res, status, type, body, headers) {
	res.writeHead(status, Object.assign({ "Content-Type": type, "Content-Length": Buffer.byteLength(body) }, headers));
	res.end(body);
}

async function serveFile(req, res, file, stat, status, headers) {
	const etag = '"' + stat.size.toString(36) + "-" + Math.floor(stat.mtimeMs).toString(36) + '"';
	headers = Object.assign({
		"Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
		"Cache-Control": "no-cache", // always revalidate, so edits show up on reload
		"ETag": etag,
		"X-Content-Type-Options": "nosniff"
	}, headers);
	if (status === 200 && req.headers["if-none-match"] === etag) {
		res.writeHead(304, headers);
		return res.end();
	}
	headers["Content-Length"] = stat.size;
	res.writeHead(status, headers);
	if (req.method === "HEAD") return res.end();
	fs.createReadStream(file).on("error", () => res.destroy()).pipe(res);
}

function createServer(siteRoot) {
	const root = fs.realpathSync(siteRoot);

	// Map a URL path to a file inside the site, or null if it isn't allowed.
	async function resolveInSite(pathname) {
		let decoded;
		try { decoded = decodeURIComponent(pathname); }
		catch (err) { return null; }
		if (decoded.includes("\0") || decoded.includes("\\")) return null;
		const parts = decoded.split("/").filter(Boolean);
		if (parts.some((p) => p.startsWith("."))) return null; // no "..", no dotfiles
		return path.join(root, ...parts);
	}

	async function insideRoot(file) {
		try {
			const real = await fs.promises.realpath(file);
			return real === root || real.startsWith(root + path.sep);
		}
		catch (err) { return false; }
	}

	async function handle(req, res) {
		if (req.method !== "GET" && req.method !== "HEAD") {
			return send(res, 405, "text/plain", "Method not allowed\n", { Allow: "GET, HEAD" });
		}
		const url = new URL(req.url, "http://localhost");

		// the browser app itself
		if (url.pathname.startsWith("/_mb/")) {
			const rel = url.pathname.slice("/_mb/".length);
			const file = rel.startsWith("lib/") ? path.join(LIB_DIR, path.basename(rel)) : path.join(APP_DIR, path.basename(rel));
			const stat = await statOrNull(file);
			if (!stat || !stat.isFile()) return send(res, 404, "text/plain", "Not found\n");
			return serveFile(req, res, file, stat, 200);
		}

		let file = await resolveInSite(url.pathname);
		if (!file) return send(res, 404, "text/plain", "Not found\n");
		let stat = await statOrNull(file);

		if (stat && stat.isDirectory()) {
			if (!url.pathname.endsWith("/")) {
				res.writeHead(301, { Location: url.pathname + "/" + url.search });
				return res.end();
			}
			file = path.join(file, "index.md");
			stat = await statOrNull(file);
		}
		if (stat && !(await insideRoot(file))) stat = null; // symlink pointing outside the site
		const exists = !!(stat && stat.isFile());

		if (/\.md$/i.test(file)) {
			const accept = req.headers.accept || "";
			if (!url.searchParams.has("raw") && accept.includes("text/html")) {
				const shellStat = await statOrNull(SHELL);
				return serveFile(req, res, SHELL, shellStat, exists ? 200 : 404, {
					"Content-Security-Policy": SHELL_CSP,
					"Vary": "Accept"
				});
			}
			if (!exists) return send(res, 404, "text/plain", "Not found\n", { "Vary": "Accept" });
			return serveFile(req, res, file, stat, 200, { "Vary": "Accept" });
		}

		if (!exists) return send(res, 404, "text/plain", "Not found\n");
		return serveFile(req, res, file, stat, 200);
	}

	return http.createServer((req, res) => {
		handle(req, res).catch((err) => {
			console.error(err);
			if (!res.headersSent) send(res, 500, "text/plain", "Server error\n");
			else res.destroy();
		});
	});
}

function main() {
	let opts;
	try { opts = parseArgs(process.argv.slice(2)); }
	catch (err) {
		console.error(err.message);
		process.exit(2);
	}
	if (opts.version) {
		console.log(require("./package.json").version);
		return;
	}
	if (opts.help) {
		console.log("Usage: browsemd [siteFolder] [--port 1994] [--host 127.0.0.1]\n\n" +
			"Serves a folder of Markdown files as a browsable web of documents.\n" +
			"With no folder, uses the current folder if it has an index.md, else the sample site.");
		return;
	}
	const site = chooseSite(opts.site);
	if (!fs.existsSync(site) || !fs.statSync(site).isDirectory()) {
		console.error("Not a folder: " + site);
		process.exit(1);
	}
	const server = createServer(site);
	server.on("error", (err) => {
		console.error(err.code === "EADDRINUSE" ? "Port " + opts.port + " is already in use. Try --port." : err.message);
		process.exit(1);
	});
	server.listen(opts.port, opts.host, () => {
		const shownHost = opts.host === "0.0.0.0" || opts.host === "::" ? "localhost" : opts.host;
		console.log("Markdown Browser serving " + site);
		console.log("Open http://" + shownHost + ":" + opts.port + "/");
	});
}

if (require.main === module) main();

module.exports = { createServer };
