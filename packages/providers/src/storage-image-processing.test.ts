/**
 * Integration-ish tests for the image processing pipeline — real sharp
 * calls and real disk writes under a throwaway subdir (no network, no DB),
 * so these run in every environment without external fixtures.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { rm, readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { processImageBuffer, resolveUploadPath } from "./storage";

const RUN = Date.now();
const SUBDIR = `test-fixture-image-processing-${RUN}`;

after(async () => {
  const dir = resolveUploadPath([SUBDIR]);
  if (dir) await rm(path.dirname(dir), { recursive: true, force: true }).catch(() => {});
});

async function makeTestJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 50, b: 50 } },
  })
    .jpeg()
    .toBuffer();
}

test("processes a valid JPEG into three WebP sizes with platform-owned URLs", async () => {
  const source = await makeTestJpeg(1000, 1000);
  const result = await processImageBuffer(source, "image/jpeg", 5 * 1024 * 1024, SUBDIR);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.ok(result.urls.url.startsWith("/api/uploads/"));
  assert.ok(result.urls.url.endsWith("-main.webp"));
  assert.ok(result.urls.thumbnailUrl.endsWith("-thumbnail.webp"));
  assert.ok(result.urls.mediumUrl.endsWith("-medium.webp"));
  assert.equal(result.urls.belowRecommendedSize, false);

  // The files genuinely exist on disk and decode as valid WebP at the
  // expected square dimensions.
  for (const [url, expectedDim] of [
    [result.urls.thumbnailUrl, 300],
    [result.urls.mediumUrl, 800],
    [result.urls.url, 1200],
  ] as const) {
    const relative = url.replace("/api/uploads/", "");
    const filePath = resolveUploadPath(relative.split("/"));
    assert.ok(filePath);
    const bytes = await readFile(filePath!);
    const meta = await sharp(bytes).metadata();
    assert.equal(meta.format, "webp");
    assert.equal(meta.width, expectedDim);
    assert.equal(meta.height, expectedDim);
  }
});

test("flags a source image below the recommended 800x800 minimum, without failing", async () => {
  const source = await makeTestJpeg(400, 400);
  const result = await processImageBuffer(source, "image/jpeg", 5 * 1024 * 1024, SUBDIR);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.urls.belowRecommendedSize, true);
  assert.equal(result.urls.sourceWidth, 400);
});

test("rejects a file over the size limit before ever touching sharp", async () => {
  const oversized = Buffer.alloc(200);
  const result = await processImageBuffer(oversized, "image/jpeg", 100, SUBDIR);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, "FILE_TOO_LARGE");
});

test("rejects a declared MIME type outside the allowlist", async () => {
  const source = await makeTestJpeg(500, 500);
  const result = await processImageBuffer(source, "image/gif", 5 * 1024 * 1024, SUBDIR);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, "UNSUPPORTED_TYPE");
});

test("rejects bytes that don't match any allowed image signature, regardless of the declared MIME type", async () => {
  const fakeImage = Buffer.from("this is not actually an image file, just text pretending to be one");
  const result = await processImageBuffer(fakeImage, "image/jpeg", 5 * 1024 * 1024, SUBDIR);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, "SIGNATURE_MISMATCH");
});

test("rejects an SVG even if it were somehow declared as an allowed MIME type", async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>');
  const result = await processImageBuffer(svg, "image/png", 5 * 1024 * 1024, SUBDIR);
  assert.equal(result.ok, false);
  // An SVG's bytes don't match the PNG/JPEG/WEBP magic-byte signatures
  // either, so this is caught at the same signature-mismatch gate —
  // proving there's no path through this pipeline that accepts SVG
  // content regardless of which specific check catches it first.
  if (result.ok) return;
  assert.equal(result.error, "SIGNATURE_MISMATCH");
});
