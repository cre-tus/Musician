import assert from 'node:assert/strict';
import { adjustImageZoom, imageZoomPercent, MAX_IMAGE_ZOOM, MIN_IMAGE_ZOOM } from '../src/lib/image-zoom.mjs';

assert.equal(adjustImageZoom(1, 1), 1.25);
assert.equal(adjustImageZoom(1, -1), 0.75);
assert.equal(adjustImageZoom(MIN_IMAGE_ZOOM, -1), MIN_IMAGE_ZOOM);
assert.equal(adjustImageZoom(MAX_IMAGE_ZOOM, 1), MAX_IMAGE_ZOOM);
assert.equal(adjustImageZoom(Number.NaN, 1), 1.25);
assert.equal(imageZoomPercent(1.25), '125%');
assert.equal(imageZoomPercent(Number.NaN), '100%');

console.log('Image preview zoom checks passed.');
