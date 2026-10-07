// The document model: the small, normalized structure every renderer consumes.
// Renderers should only ever need to know the shapes described here, never Markdown.
//
// Document:
//   { url, title, meta, nodes, links }
//
// Block nodes:
//   { type: "heading",    level, id, text, content }
//   { type: "paragraph",  text, content }
//   { type: "list",       ordered, start, tight, items: [ { nodes } ] }
//   { type: "blockquote", nodes }
//   { type: "code",       lang, text }
//   { type: "rule" }
//
// Inline nodes (the `content` arrays above):
//   { type: "text",     text }
//   { type: "strong",   content }
//   { type: "emphasis", content }
//   { type: "code",     text }
//   { type: "link",     href, title, content }
//   { type: "image",    src, alt, title }
//   { type: "break" }
//
// `text` on headings and paragraphs is the plain-text version of `content`,
// for renderers (outlines, OPML, graph labels) that don't want inline markup.
//
// `meta` is the optional front matter as a flat object of strings. Fields with
// meaning so far: title, previous, next, home. They describe relationships,
// never presentation.
//
// `links` is every link in the document, in order, as { href, text }. hrefs are
// exactly as written; resolve them against `url` to get a graph of documents.

(function (exports) {
	"use strict";

	function plainText(content) {
		var s = "";
		content.forEach(function (n) {
			if (n.type === "text" || n.type === "code") s += n.text;
			else if (n.type === "image") s += n.alt;
			else if (n.type === "break") s += "\n";
			else if (n.content) s += plainText(n.content);
		});
		return s;
	}

	function slugify(text) {
		return text.toLowerCase().trim()
			.replace(/[^\p{L}\p{N}\s-]/gu, "")
			.replace(/\s+/g, "-") || "section";
	}

	function walk(nodes, fn) {
		nodes.forEach(function (n) {
			fn(n);
			if (n.nodes) walk(n.nodes, fn);
			if (n.items) n.items.forEach(function (item) { walk(item.nodes, fn); });
		});
	}

	function collectLinks(content, links) {
		content.forEach(function (n) {
			if (n.type === "link") links.push({ href: n.href, text: plainText(n.content) });
			if (n.content) collectLinks(n.content, links);
		});
	}

	function titleFromUrl(url) {
		var name = (url || "").split(/[?#]/)[0].replace(/\/$/, "/index.md").split("/").pop();
		return decodeURIComponent(name.replace(/\.md$/i, "")) || "Untitled";
	}

	// Build the finished document: assign heading ids, infer the title, gather links.
	function makeDocument(url, meta, nodes) {
		var title = meta.title || null;
		var links = [];
		var usedIds = {};
		walk(nodes, function (n) {
			if (n.type === "heading") {
				var id = slugify(n.text), base = id, i = 1;
				while (usedIds[id]) id = base + "-" + (i++);
				usedIds[id] = true;
				n.id = id;
				if (!title && n.level === 1) title = n.text;
			}
			if (n.content) collectLinks(n.content, links);
		});
		return {
			url: url || "",
			title: title || titleFromUrl(url),
			meta: meta,
			nodes: nodes,
			links: links
		};
	}

	exports.plainText = plainText;
	exports.makeDocument = makeDocument;
})(typeof module !== "undefined" ? module.exports : (window.DocumentModel = {}));
