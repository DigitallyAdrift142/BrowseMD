// Document model -> HTML string.
// Knows the document model, not Markdown. Every piece of text is escaped:
// documents cannot inject markup, styles, or scripts.

(function (exports) {
	"use strict";

	function esc(s) {
		return String(s).replace(/[&<>"']/g, function (c) {
			return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
		});
	}

	var SAFE_SCHEMES = /^(https?|mailto|ftp|tel):$/i;

	// Relative URLs and ordinary web schemes pass; javascript:, data:, etc. don't.
	function safeUrl(url) {
		var scheme = /^\s*([a-z][a-z0-9+.-]*:)/i.exec(url);
		return scheme && !SAFE_SCHEMES.test(scheme[1]) ? "#" : url;
	}

	function titleAttr(title) {
		return title ? ' title="' + esc(title) + '"' : "";
	}

	function inlines(content) {
		return content.map(function (n) {
			switch (n.type) {
				case "text": return esc(n.text);
				case "strong": return "<strong>" + inlines(n.content) + "</strong>";
				case "emphasis": return "<em>" + inlines(n.content) + "</em>";
				case "code": return "<code>" + esc(n.text) + "</code>";
				case "break": return "<br>";
				case "link":
					return '<a href="' + esc(safeUrl(n.href)) + '"' + titleAttr(n.title) + ">" + inlines(n.content) + "</a>";
				case "image":
					return '<img src="' + esc(safeUrl(n.src)) + '" alt="' + esc(n.alt) + '"' + titleAttr(n.title) + ' loading="lazy">';
				default: return "";
			}
		}).join("");
	}

	function blocks(nodes, tight) {
		return nodes.map(function (n) {
			switch (n.type) {
				case "heading":
					return "<h" + n.level + ' id="' + esc(n.id) + '">' + inlines(n.content) + "</h" + n.level + ">";
				case "paragraph":
					return tight ? inlines(n.content) : "<p>" + inlines(n.content) + "</p>";
				case "list":
					var tag = n.ordered ? "ol" : "ul";
					var start = n.ordered && n.start !== 1 ? ' start="' + n.start + '"' : "";
					return "<" + tag + start + ">" + n.items.map(function (item) {
						return "<li>" + blocks(item.nodes, n.tight) + "</li>";
					}).join("") + "</" + tag + ">";
				case "blockquote":
					return "<blockquote>" + blocks(n.nodes) + "</blockquote>";
				case "code":
					var lang = n.lang ? ' data-lang="' + esc(n.lang) + '"' : "";
					return "<pre" + lang + "><code>" + esc(n.text) + "</code></pre>";
				case "rule":
					return "<hr>";
				default: return "";
			}
		}).join("\n");
	}

	function renderHtml(doc) {
		return blocks(doc.nodes);
	}

	exports.renderHtml = renderHtml;
	exports.escapeHtml = esc;
	exports.safeUrl = safeUrl;
})(typeof module !== "undefined" ? module.exports : (window.HtmlRenderer = {}));
