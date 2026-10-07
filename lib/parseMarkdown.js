// Markdown -> document model.
// This is the only file that knows Markdown syntax. It covers standard Markdown:
// headings, paragraphs, bold, italics, links, images, lists, blockquotes, code,
// code blocks, horizontal rules, plus optional YAML-style front matter.
// Raw HTML is not interpreted; it shows up as text.
//
// Runs unchanged in the browser and in Node.

(function (exports, DocumentModel) {
	"use strict";

	var RE = {
		fence: /^ {0,3}(`{3,}|~{3,})(.*)$/,
		fenceClose: /^ {0,3}(`{3,}|~{3,})[ \t]*$/,
		heading: /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/,
		rule: /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/,
		quote: /^ {0,3}> ?/,
		listItem: /^( {0,3})(?:([-*+])|(\d{1,9})([.)]))([ \t]+|$)/,
		setext: /^ {0,3}(=+|-+)[ \t]*$/,
		refDef: /^ {0,3}\[([^\]]+)\]:[ \t]*<?([^\s>]+)>?(?:[ \t]+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\)))?[ \t]*$/,
		escapable: /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/,
		wordChar: /[\p{L}\p{N}]/u,
		space: /\s/
	};

	// ---------- lines and indentation ----------

	function isBlank(line) {
		return /^[ \t]*$/.test(line);
	}

	function indentOf(line) {
		var col = 0;
		for (var i = 0; i < line.length; i++) {
			if (line[i] === " ") col++;
			else if (line[i] === "\t") col += 4 - (col % 4);
			else break;
		}
		return col;
	}

	// Remove up to n columns of leading whitespace, splitting a tab if needed.
	function stripCols(line, n) {
		var col = 0, i = 0;
		while (col < n && i < line.length) {
			if (line[i] === " ") { col++; i++; }
			else if (line[i] === "\t") {
				var w = 4 - (col % 4);
				if (col + w > n) return " ".repeat(col + w - n) + line.slice(i + 1);
				col += w; i++;
			}
			else break;
		}
		return line.slice(i);
	}

	function listMarker(line) {
		var m = RE.listItem.exec(line);
		if (!m) return null;
		var markerEnd = m[1].length + (m[2] ? 1 : m[3].length + 1);
		var spacing = m[5];
		var contentIndent = (spacing === "" || spacing.indexOf("\t") >= 0 || spacing.length > 4)
			? markerEnd + 1
			: markerEnd + spacing.length;
		return {
			ordered: !m[2],
			start: m[3] ? parseInt(m[3], 10) : null,
			delim: m[2] || m[4],
			contentIndent: contentIndent,
			rest: spacing === "" ? "" : stripCols(" ".repeat(markerEnd) + line.slice(markerEnd), contentIndent)
		};
	}

	function isFence(line) {
		var m = RE.fence.exec(line);
		if (!m || (m[1][0] === "`" && m[2].indexOf("`") >= 0)) return null;
		return m;
	}

	// Does this line start a new block, ending a paragraph in progress?
	function interruptsParagraph(line) {
		if (indentOf(line) >= 4) return false;
		if (isFence(line) || RE.heading.test(line) || RE.rule.test(line) || RE.quote.test(line)) return true;
		var mk = listMarker(line);
		return !!(mk && mk.rest.trim() && (!mk.ordered || mk.start === 1));
	}

	function normalizeLabel(label) {
		return label.trim().replace(/\s+/g, " ").toLowerCase();
	}

	// ---------- front matter ----------

	function splitFrontMatter(text) {
		var m = /^---[ \t]*\n([\s\S]*?)\n(?:---|\.\.\.)[ \t]*(?:\n|$)/.exec(text);
		if (!m) return { meta: {}, body: text };
		var meta = {}, found = false;
		var lines = m[1].split("\n");
		for (var i = 0; i < lines.length; i++) {
			var line = lines[i];
			if (isBlank(line) || /^\s*#/.test(line)) continue;
			var kv = /^([A-Za-z0-9_-]+)[ \t]*:[ \t]*(.*?)[ \t]*$/.exec(line);
			if (kv) {
				meta[kv[1]] = kv[2].replace(/^"(.*)"$|^'(.*)'$/, "$1$2");
				found = true;
			}
			else if (!/^\s/.test(line)) return { meta: {}, body: text }; // not front matter after all
		}
		return found ? { meta: meta, body: text.slice(m[0].length) } : { meta: {}, body: text };
	}

	// ---------- blocks ----------
	// Inline-bearing nodes get a temporary `raw` string; inlines are parsed after
	// all blocks so reference-style link definitions anywhere in the file apply.

	function parseBlocks(lines, refs) {
		var nodes = [], i = 0, n = lines.length, m;

		while (i < n) {
			var line = lines[i];
			if (isBlank(line)) { i++; continue; }

			// indented code block
			if (indentOf(line) >= 4) {
				var code = [];
				while (i < n && (isBlank(lines[i]) || indentOf(lines[i]) >= 4)) {
					code.push(stripCols(lines[i], 4));
					i++;
				}
				while (code.length && isBlank(code[code.length - 1])) code.pop();
				nodes.push({ type: "code", lang: "", text: code.join("\n") });
				continue;
			}

			// fenced code block
			if ((m = isFence(line))) {
				var fence = m[1], fenceIndent = indentOf(line), body = [];
				i++;
				while (i < n) {
					var close = RE.fenceClose.exec(lines[i]);
					if (close && close[1][0] === fence[0] && close[1].length >= fence.length) { i++; break; }
					body.push(stripCols(lines[i], fenceIndent));
					i++;
				}
				nodes.push({ type: "code", lang: m[2].trim().split(/\s+/)[0], text: body.join("\n") });
				continue;
			}

			if ((m = RE.heading.exec(line))) {
				var raw = (m[2] || "").replace(/(?:^|[ \t]+)#+[ \t]*$/, "");
				nodes.push({ type: "heading", level: m[1].length, raw: raw });
				i++;
				continue;
			}

			if (RE.rule.test(line)) {
				nodes.push({ type: "rule" });
				i++;
				continue;
			}

			if (RE.quote.test(line)) {
				var quoted = [];
				while (i < n && !isBlank(lines[i])) {
					if (RE.quote.test(lines[i])) quoted.push(lines[i].replace(RE.quote, ""));
					else if (!interruptsParagraph(lines[i])) quoted.push(lines[i]); // lazy continuation
					else break;
					i++;
				}
				nodes.push({ type: "blockquote", nodes: parseBlocks(quoted, refs) });
				continue;
			}

			var first = listMarker(line);
			if (first) {
				var list = { type: "list", ordered: first.ordered, start: first.start, tight: true, items: [] };
				var blankBefore = false;
				while (i < n) {
					var mk = listMarker(lines[i]);
					if (!mk || mk.ordered !== first.ordered || mk.delim !== first.delim || RE.rule.test(lines[i])) break;
					if (blankBefore) list.tight = false;
					var itemLines = [mk.rest], lastBlank = false;
					i++;
					while (i < n) {
						var l = lines[i];
						if (isBlank(l)) { itemLines.push(""); lastBlank = true; i++; continue; }
						if (indentOf(l) >= mk.contentIndent) {
							if (lastBlank) list.tight = false;
							itemLines.push(stripCols(l, mk.contentIndent));
							lastBlank = false; i++;
							continue;
						}
						if (!lastBlank && !interruptsParagraph(l) && !listMarker(l)) { itemLines.push(l); i++; continue; } // lazy
						break;
					}
					blankBefore = false;
					while (itemLines.length && isBlank(itemLines[itemLines.length - 1])) { itemLines.pop(); blankBefore = true; }
					list.items.push({ nodes: parseBlocks(itemLines, refs) });
				}
				nodes.push(list);
				continue;
			}

			if ((m = RE.refDef.exec(line))) {
				var key = normalizeLabel(m[1]);
				if (!(key in refs)) refs[key] = { href: m[2], title: m[3] || m[4] || m[5] || "" };
				i++;
				continue;
			}

			// paragraph, possibly turned into a setext heading
			var para = [], level = 0;
			while (i < n && !isBlank(lines[i])) {
				var pl = lines[i];
				if (para.length && indentOf(pl) < 4) {
					var st = RE.setext.exec(pl);
					if (st) { level = st[1][0] === "=" ? 1 : 2; i++; break; }
					if (interruptsParagraph(pl)) break;
				}
				para.push(pl.replace(/^[ \t]+/, ""));
				i++;
			}
			var text = para.join("\n").replace(/[ \t]+$/, "");
			nodes.push(level ? { type: "heading", level: level, raw: text } : { type: "paragraph", raw: text });
		}
		return nodes;
	}

	// ---------- inlines ----------

	function runLength(s, i, ch) {
		var j = i;
		while (s[j] === ch) j++;
		return j - i;
	}

	function findCodeClose(s, from, run) {
		for (var j = from; j < s.length;) {
			if (s[j] === "`") {
				var r = runLength(s, j, "`");
				if (r === run) return j;
				j += r;
			}
			else j++;
		}
		return -1;
	}

	// Index of the "]" matching the "[" at i, or -1.
	function findLabelEnd(s, i) {
		var depth = 0;
		for (var j = i; j < s.length; j++) {
			var c = s[j];
			if (c === "\\") j++;
			else if (c === "`") {
				var r = runLength(s, j, "`"), close = findCodeClose(s, j + r, r);
				if (close >= 0) j = close + r - 1;
				else j += r - 1;
			}
			else if (c === "[") depth++;
			else if (c === "]" && --depth === 0) return j;
		}
		return -1;
	}

	function unescapeText(s) {
		return s.replace(/\\(.)/g, function (all, c) { return RE.escapable.test(c) ? c : all; });
	}

	// Parse a link or image starting at the "[" at i.
	// Returns { label, href, title, end } or null.
	function parseLinkish(s, i, refs) {
		var end = findLabelEnd(s, i);
		if (end < 0) return null;
		var label = s.slice(i + 1, end), j = end + 1;

		if (s[j] === "(") {
			var k = j + 1, href, title = "";
			while (RE.space.test(s[k] || "")) k++;
			if (s[k] === "<") {
				var gt = s.indexOf(">", k);
				if (gt < 0) return null;
				href = s.slice(k + 1, gt);
				k = gt + 1;
			}
			else {
				var depth = 0, startHref = k;
				while (k < s.length) {
					var ch = s[k];
					if (ch === "\\") { k += 2; continue; }
					if (RE.space.test(ch)) break;
					if (ch === "(") depth++;
					else if (ch === ")") { if (depth === 0) break; depth--; }
					k++;
				}
				href = s.slice(startHref, k);
			}
			while (RE.space.test(s[k] || "")) k++;
			if (s[k] === '"' || s[k] === "'" || s[k] === "(") {
				var q = s[k] === "(" ? ")" : s[k], qe = s.indexOf(q, k + 1);
				if (qe < 0) return null;
				title = s.slice(k + 1, qe);
				k = qe + 1;
				while (RE.space.test(s[k] || "")) k++;
			}
			if (s[k] !== ")") return null;
			return { label: label, href: unescapeText(href), title: unescapeText(title), end: k + 1 };
		}

		// reference-style: [text][ref], [text][], or [text]
		var ref = label, refEnd = j;
		if (s[j] === "[") {
			var e2 = findLabelEnd(s, j);
			if (e2 >= 0) {
				var inner = s.slice(j + 1, e2);
				if (inner.trim()) ref = inner;
				refEnd = e2 + 1;
			}
		}
		var def = refs[normalizeLabel(ref)];
		if (!def) return null;
		return { label: label, href: def.href, title: def.title, end: refEnd };
	}

	function findEmphasisClose(s, from, ch, k) {
		for (var j = from; j < s.length;) {
			var c = s[j];
			if (c === "\\") { j += 2; continue; }
			if (c === "`") {
				var r = runLength(s, j, "`"), close = findCodeClose(s, j + r, r);
				j = close >= 0 ? close + r : j + r;
				continue;
			}
			if (c === ch) {
				var run = runLength(s, j, ch), next = s[j + run];
				var rightFlanking = j > from && !RE.space.test(s[j - 1]);
				var wordAfter = ch === "_" && next && RE.wordChar.test(next);
				if (run === k && rightFlanking && !wordAfter) return j;
				j += run;
				continue;
			}
			j++;
		}
		return -1;
	}

	function parseEmphasis(s, i, refs) {
		var ch = s[i], k = runLength(s, i, ch), after = s[i + k];
		if (k > 3 || !after || RE.space.test(after)) return null;
		if (ch === "_" && i > 0 && RE.wordChar.test(s[i - 1])) return null; // snake_case
		var close = findEmphasisClose(s, i + k, ch, k);
		if (close < 0) return null;
		var content = parseInlines(s.slice(i + k, close), refs);
		var node;
		if (k === 1) node = { type: "emphasis", content: content };
		else if (k === 2) node = { type: "strong", content: content };
		else node = { type: "strong", content: [{ type: "emphasis", content: content }] };
		return { node: node, end: close + k };
	}

	var AUTOLINK = /<([a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s<>]*)>/y;
	var EMAIL = /<([^\s@<>\\]+@[^\s@<>\\]+\.[^\s@<>\\]+)>/y;

	function parseInlines(s, refs) {
		var out = [], text = "", i = 0, m, r;

		function push(node) {
			if (text) { out.push({ type: "text", text: text }); text = ""; }
			out.push(node);
		}

		while (i < s.length) {
			var c = s[i];

			if (c === "\\") {
				var next = s[i + 1];
				if (next === "\n") { push({ type: "break" }); i += 2; continue; }
				if (next && RE.escapable.test(next)) { text += next; i += 2; continue; }
				text += c; i++;
				continue;
			}

			if (c === "\n") {
				var trimmed = text.replace(/ +$/, "");
				if (text.length - trimmed.length >= 2) { text = trimmed; push({ type: "break" }); }
				else text = trimmed + "\n";
				i++;
				continue;
			}

			if (c === "`") {
				var run = runLength(s, i, "`"), close = findCodeClose(s, i + run, run);
				if (close < 0) { text += s.substr(i, run); i += run; continue; }
				var code = s.slice(i + run, close).replace(/\n/g, " ");
				if (code.length >= 2 && code[0] === " " && code[code.length - 1] === " " && /[^ ]/.test(code)) code = code.slice(1, -1);
				push({ type: "code", text: code });
				i = close + run;
				continue;
			}

			if (c === "!" && s[i + 1] === "[" && (r = parseLinkish(s, i + 1, refs))) {
				var alt = DocumentModel.plainText(parseInlines(r.label, refs));
				push({ type: "image", src: r.href, alt: alt, title: r.title });
				i = r.end;
				continue;
			}

			if (c === "[" && (r = parseLinkish(s, i, refs))) {
				push({ type: "link", href: r.href, title: r.title, content: parseInlines(r.label, refs) });
				i = r.end;
				continue;
			}

			if (c === "<") {
				AUTOLINK.lastIndex = EMAIL.lastIndex = i;
				if ((m = AUTOLINK.exec(s))) {
					push({ type: "link", href: m[1], title: "", content: [{ type: "text", text: m[1] }] });
					i += m[0].length;
					continue;
				}
				if ((m = EMAIL.exec(s))) {
					push({ type: "link", href: "mailto:" + m[1], title: "", content: [{ type: "text", text: m[1] }] });
					i += m[0].length;
					continue;
				}
			}

			if (c === "*" || c === "_") {
				if ((r = parseEmphasis(s, i, refs))) { push(r.node); i = r.end; continue; }
				var len = runLength(s, i, c);
				text += s.substr(i, len);
				i += len;
				continue;
			}

			text += c;
			i++;
		}
		if (text) out.push({ type: "text", text: text });
		return out;
	}

	function finishInlines(nodes, refs) {
		nodes.forEach(function (n) {
			if ("raw" in n) {
				n.content = parseInlines(n.raw, refs);
				n.text = DocumentModel.plainText(n.content);
				delete n.raw;
			}
			if (n.nodes) finishInlines(n.nodes, refs);
			if (n.items) n.items.forEach(function (item) { finishInlines(item.nodes, refs); });
		});
	}

	// ---------- entry point ----------

	function parseMarkdown(source, url) {
		source = String(source).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
		var fm = splitFrontMatter(source);
		var refs = {};
		var nodes = parseBlocks(fm.body.split("\n"), refs);
		finishInlines(nodes, refs);
		return DocumentModel.makeDocument(url, fm.meta, nodes);
	}

	exports.parseMarkdown = parseMarkdown;
})(
	typeof module !== "undefined" ? module.exports : (window.MarkdownParser = {}),
	typeof module !== "undefined" ? require("./documentModel.js") : window.DocumentModel
);
