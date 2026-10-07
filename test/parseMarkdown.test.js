"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { parseMarkdown } = require("../lib/parseMarkdown.js");
const { renderHtml } = require("../client/renderHtml.js");

const html = (md) => renderHtml(parseMarkdown(md, "/test.md"));

test("title comes from front matter, then first h1, then filename", () => {
	assert.strictEqual(parseMarkdown("---\ntitle: Meta\n---\n# Heading", "/a.md").title, "Meta");
	assert.strictEqual(parseMarkdown("Intro\n\n# Heading", "/a.md").title, "Heading");
	assert.strictEqual(parseMarkdown("no heading", "/2026/10/06.md").title, "06");
	assert.strictEqual(parseMarkdown("no heading", "/2026/").title, "index");
});

test("front matter is optional and only key: value", () => {
	const doc = parseMarkdown("---\nprevious: 05.md\nnext: \"07.md\"\n---\n\nHi", "/x.md");
	assert.deepStrictEqual(doc.meta, { previous: "05.md", next: "07.md" });
	// a leading rule followed by prose is not front matter
	const notMeta = parseMarkdown("---\nJust some text.\n---\n", "/x.md");
	assert.deepStrictEqual(notMeta.meta, {});
});

test("headings", () => {
	assert.strictEqual(html("# One\n## Two ##\n#nope"), '<h1 id="one">One</h1>\n<h2 id="two">Two</h2>\n<p>#nope</p>');
	assert.strictEqual(html("Setext\n==="), '<h1 id="setext">Setext</h1>');
	assert.strictEqual(html("# Same\n# Same"), '<h1 id="same">Same</h1>\n<h1 id="same-1">Same</h1>');
});

test("inline formatting", () => {
	assert.strictEqual(html("**b** *i* _i_ ***bi*** `c`"),
		"<p><strong>b</strong> <em>i</em> <em>i</em> <strong><em>bi</em></strong> <code>c</code></p>");
	assert.strictEqual(html("snake_case_name and 2 * 3 * 4"), "<p>snake_case_name and 2 * 3 * 4</p>");
	assert.strictEqual(html("*a **b** c*"), "<p><em>a <strong>b</strong> c</em></p>");
	assert.strictEqual(html("\\*not em\\*"), "<p>*not em*</p>");
	assert.strictEqual(html("`*not em*`"), "<p><code>*not em*</code></p>");
	assert.strictEqual(html("a  \nb"), "<p>a<br>b</p>");
});

test("links and images", () => {
	assert.strictEqual(html('[a](b.md "T")'), '<p><a href="b.md" title="T">a</a></p>');
	assert.strictEqual(html("[a][r]\n\n[r]: http://x.com/"), '<p><a href="http://x.com/">a</a></p>');
	assert.strictEqual(html("[r]\n\n[R]: /r.md"), '<p><a href="/r.md">r</a></p>');
	assert.strictEqual(html("![alt *x*](i.png)"), '<p><img src="i.png" alt="alt x" loading="lazy"></p>');
	assert.strictEqual(html("<http://x.com/>"), '<p><a href="http://x.com/">http://x.com/</a></p>');
	assert.strictEqual(html("[a](https://en.wikipedia.org/wiki/Foo_(bar))"),
		'<p><a href="https://en.wikipedia.org/wiki/Foo_(bar)">a</a></p>');
	assert.strictEqual(html("[not a link] [x]"), "<p>[not a link] [x]</p>");
});

test("links are collected for the document graph", () => {
	const doc = parseMarkdown("[One](1.md) and *[Two](2.md)*\n\n- [Three](https://x.com)", "/i.md");
	assert.deepStrictEqual(doc.links, [
		{ href: "1.md", text: "One" }, { href: "2.md", text: "Two" }, { href: "https://x.com", text: "Three" }
	]);
});

test("lists", () => {
	assert.strictEqual(html("- a\n- b\n  - c\n- d"), "<ul><li>a</li><li>b\n<ul><li>c</li></ul></li><li>d</li></ul>");
	assert.strictEqual(html("3. a\n4. b"), '<ol start="3"><li>a</li><li>b</li></ol>');
	assert.strictEqual(html("- a\n\n- b"), "<ul><li><p>a</p></li><li><p>b</p></li></ul>");
	assert.strictEqual(html("- a\nlazy"), "<ul><li>a\nlazy</li></ul>");
	assert.strictEqual(html("- a\n* b"), "<ul><li>a</li></ul>\n<ul><li>b</li></ul>");
});

test("blockquotes, code, rules", () => {
	assert.strictEqual(html("> a\n> b\n>\n> c"), "<blockquote><p>a\nb</p>\n<p>c</p></blockquote>");
	assert.strictEqual(html("```js\n\tx < 1\n```"), '<pre data-lang="js"><code>\tx &lt; 1</code></pre>');
	assert.strictEqual(html("    code\n\n    more"), "<pre><code>code\n\nmore</code></pre>");
	assert.strictEqual(html("a\n\n***\n\n- - -"), "<p>a</p>\n<hr>\n<hr>");
});

test("documents can't inject markup or script", () => {
	assert.strictEqual(html("<script>alert(1)</script>"), "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
	assert.strictEqual(html("[x](javascript:alert(1))"), '<p><a href="#">x</a></p>');
	assert.strictEqual(html("[x](a.md 'a\" onclick=\"y')"), '<p><a href="a.md" title="a&quot; onclick=&quot;y">x</a></p>');
	assert.strictEqual(html("![x](data:text/html,hi)"), '<p><img src="#" alt="x" loading="lazy"></p>');
});
