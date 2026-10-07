// The browser: fetch Markdown, parse it into the document model, render, and
// keep the address bar and history in step. History is the web platform's own;
// there is no parallel navigation stack.

(function () {
	"use strict";

	var page, relations, current = null, loadSeq = 0, saveTimer = null;

	// A link stays inside the Markdown Browser if it points at a Markdown file
	// (or a directory, meaning its index.md) on this server.
	function isDocumentUrl(url) {
		return url.origin === location.origin &&
			(/\.md$/i.test(url.pathname) || url.pathname.endsWith("/")) &&
			!url.searchParams.has("raw");
	}

	function messageDocument(title, message) {
		return "# " + title + "\n\n" + message + "\n\n[Home](/)\n";
	}

	async function fetchMarkdown(url) {
		try {
			var res = await fetch(url.pathname, { headers: { Accept: "text/markdown" } });
			// Not Markdown: most likely a login page from a proxy in front of the
			// server. Hand the navigation to the browser so the login flow can run.
			if (res.ok && (res.redirected || !/markdown/.test(res.headers.get("Content-Type") || ""))) return null;
			if (res.ok) return await res.text();
			if (res.status === 404) return messageDocument("Not found", "There is no document at `" + url.pathname + "`.");
			return messageDocument("Error " + res.status, "The server couldn't return `" + url.pathname + "`.");
		}
		catch (err) {
			return messageDocument("Can't reach the server", "The document `" + url.pathname + "` couldn't be loaded. Is the server running?");
		}
	}

	// how: "push" (followed a link), "pop" (back/forward/reload), or "start"
	async function load(href, how, scrollY) {
		var url = new URL(href, location.href);
		var seq = ++loadSeq;
		var text = await fetchMarkdown(url);
		if (seq !== loadSeq) return; // a newer navigation started while we waited
		if (text === null) {
			if (how === "push") location.assign(url.href);
			else page.textContent = "This page isn't Markdown. Try reloading.";
			return;
		}

		var doc = MarkdownParser.parseMarkdown(text, url.pathname);
		if (how === "push") {
			saveScroll();
			history.pushState(null, "", url.pathname + url.search + url.hash);
		}
		render(doc, url);

		if (how !== "push" && typeof scrollY === "number") window.scrollTo(0, scrollY);
		else scrollToHash(url.hash);
		if (how === "push") page.focus({ preventScroll: true });
	}

	function scrollToHash(hash) {
		var target = hash && document.getElementById(decodeURIComponent(hash.slice(1)));
		if (target) target.scrollIntoView();
		else window.scrollTo(0, 0);
	}

	function render(doc, url) {
		current = { path: url.pathname, doc: doc };
		page.innerHTML = HtmlRenderer.renderHtml(doc);
		document.title = doc.title;

		// Relationships from front matter. Hrefs resolve relative to the document,
		// just like links in its body.
		var meta = doc.meta, esc = HtmlRenderer.escapeHtml, safe = HtmlRenderer.safeUrl;
		var links = [];
		if (meta.previous) links.push('<a rel="prev" href="' + esc(safe(meta.previous)) + '">&larr; Previous</a>');
		if (meta.next) links.push('<a rel="next" href="' + esc(safe(meta.next)) + '">Next &rarr;</a>');
		relations.innerHTML = links.join("");
		relations.hidden = links.length === 0;

		document.getElementById("home").href = meta.home ? safe(meta.home) : "/";
		document.getElementById("source").href = url.pathname + "?raw";
		updateButtons();
	}

	function updateButtons() {
		if (!window.navigation || !("canGoBack" in navigation)) return;
		document.getElementById("back").disabled = !navigation.canGoBack;
		document.getElementById("forward").disabled = !navigation.canGoForward;
	}

	// Remember the scroll position in the current history entry, so Back,
	// Forward, and Reload return to the same place on the page.
	function saveScroll() {
		clearTimeout(saveTimer);
		history.replaceState(Object.assign({}, history.state, { scrollY: window.scrollY }), "");
	}

	function onClick(e) {
		if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
		var a = e.target.closest("a[href]");
		if (!a || a.target || a.hasAttribute("download")) return;
		var url = new URL(a.href);
		if (!isDocumentUrl(url)) return; // external, image, or other file: ordinary web behavior
		if (current && url.pathname === current.path && url.hash) return; // in-page anchor: let the browser jump
		e.preventDefault();
		load(url.href, "push");
	}

	function onPopState(e) {
		clearTimeout(saveTimer);
		var scrollY = e.state && e.state.scrollY;
		if (current && location.pathname === current.path) {
			// same document, different #fragment
			if (typeof scrollY === "number") window.scrollTo(0, scrollY);
			else scrollToHash(location.hash);
			updateButtons();
			return;
		}
		load(location.href, "pop", scrollY);
	}

	document.addEventListener("DOMContentLoaded", function () {
		page = document.getElementById("page");
		page.tabIndex = -1;
		relations = document.getElementById("relations");
		history.scrollRestoration = "manual";

		document.getElementById("back").addEventListener("click", function () { history.back(); });
		document.getElementById("forward").addEventListener("click", function () { history.forward(); });
		document.addEventListener("click", onClick);
		window.addEventListener("popstate", onPopState);
		window.addEventListener("scroll", function () {
			clearTimeout(saveTimer);
			saveTimer = setTimeout(saveScroll, 200);
		}, { passive: true });

		load(location.href, "start", history.state && history.state.scrollY);
	});
})();
