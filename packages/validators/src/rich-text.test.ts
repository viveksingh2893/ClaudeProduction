/** Pure function tests, no DB — rich-text sanitization/validation helpers (spec item #1). */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeProductRichText,
  isRichTextEmpty,
  richTextVisibleLength,
  htmlToPlainTextExcerpt,
} from "./rich-text";

test("strips <script> tags entirely", () => {
  const result = sanitizeProductRichText('<p>Hello</p><script>alert("xss")</script>');
  assert.ok(!result.includes("<script"));
  assert.ok(!result.includes("alert"));
  assert.ok(result.includes("Hello"));
});

test("strips event-handler attributes (onerror, onclick, ...)", () => {
  const result = sanitizeProductRichText(
    '<p onclick="alert(1)">Click</p><img src="/a.jpg" onerror="alert(2)" alt="a" />',
  );
  assert.ok(!result.includes("onclick"));
  assert.ok(!result.includes("onerror"));
});

test("blocks javascript: URLs in href", () => {
  const result = sanitizeProductRichText('<a href="javascript:alert(1)">click</a>');
  assert.ok(!result.includes("javascript:"));
});

test("blocks data: URLs in img src — every description image is a real uploaded URL, never an inline blob", () => {
  const result = sanitizeProductRichText('<img src="data:image/png;base64,AAAA" alt="a" />');
  assert.ok(!result.includes("data:"));
});

test("allows the full toolbar's safe tags: headings, lists, blockquote, table, link, image", () => {
  const html =
    "<h2>Title</h2><p><strong>Bold</strong> <em>italic</em> <u>under</u></p>" +
    '<ul><li>one</li></ul><ol><li>two</li></ol><blockquote>quote</blockquote>' +
    '<table><tr><th>H</th></tr><tr><td>D</td></tr></table>' +
    '<a href="https://example.com">link</a><img src="https://example.com/a.jpg" alt="a" />';
  const result = sanitizeProductRichText(html);
  for (const tag of ["h2", "strong", "em", "u", "ul", "li", "ol", "blockquote", "table", "a", "img"]) {
    assert.ok(result.includes(`<${tag}`), `expected <${tag}> to survive sanitization`);
  }
});

test("preserves text-align style but strips an arbitrary/dangerous style property", () => {
  const aligned = sanitizeProductRichText('<p style="text-align: center;">hi</p>');
  assert.ok(aligned.includes("text-align"));
  assert.ok(aligned.includes("center"));

  const dangerous = sanitizeProductRichText(
    '<p style="text-align: center; background: url(javascript:alert(1))">hi</p>',
  );
  assert.ok(!dangerous.includes("background"));
  assert.ok(!dangerous.includes("javascript:"));
});

test("a link gets rel=noopener noreferrer nofollow added", () => {
  const result = sanitizeProductRichText('<a href="https://example.com">link</a>');
  assert.ok(result.includes("noopener"));
  assert.ok(result.includes("noreferrer"));
});

test("legacy plain-text description (no HTML at all) passes through unchanged", () => {
  const plain = "Grown in the Nashik region, this variety is known for its sweetness.";
  assert.equal(sanitizeProductRichText(plain), plain);
});

test("null/undefined/empty input sanitizes to an empty string", () => {
  assert.equal(sanitizeProductRichText(null), "");
  assert.equal(sanitizeProductRichText(undefined), "");
  assert.equal(sanitizeProductRichText(""), "");
});

test("isRichTextEmpty treats editor-empty markup as empty", () => {
  assert.equal(isRichTextEmpty("<p><br></p>"), true);
  assert.equal(isRichTextEmpty("<p></p>"), true);
  assert.equal(isRichTextEmpty(""), true);
  assert.equal(isRichTextEmpty(null), true);
  assert.equal(isRichTextEmpty("   "), true);
});

test("isRichTextEmpty is false once there's real visible text", () => {
  assert.equal(isRichTextEmpty("<p>Hello</p>"), false);
  assert.equal(isRichTextEmpty("Hello"), false);
});

test("richTextVisibleLength counts visible text only, not markup", () => {
  // "hello" = 5 visible characters, regardless of the wrapping tags.
  assert.equal(richTextVisibleLength("<p><strong>hello</strong></p>"), 5);
  assert.equal(richTextVisibleLength("<p><br></p>"), 0);
});

test("htmlToPlainTextExcerpt strips tags and truncates with an ellipsis", () => {
  const html = "<p><strong>This is a long product description</strong> with more text after it.</p>";
  const excerpt = htmlToPlainTextExcerpt(html, 20);
  assert.ok(excerpt.length <= 20);
  assert.ok(excerpt.endsWith("…"));
  assert.ok(!excerpt.includes("<"));
});

test("htmlToPlainTextExcerpt returns the full text unchanged when it already fits", () => {
  const excerpt = htmlToPlainTextExcerpt("<p>Short</p>", 100);
  assert.equal(excerpt, "Short");
});
