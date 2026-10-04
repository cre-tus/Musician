export const MIN_IMAGE_ZOOM = 0.25;
export const MAX_IMAGE_ZOOM = 5;
const IMAGE_ZOOM_STEP = 0.25;

export function adjustImageZoom(current, steps) {
  const value = Number.isFinite(current) ? current : 1;
  const amount = Number.isFinite(steps) ? steps : 0;
  const next = Math.round((value + amount * IMAGE_ZOOM_STEP) * 100) / 100;
  return Math.min(MAX_IMAGE_ZOOM, Math.max(MIN_IMAGE_ZOOM, next));
}

export function imageZoomPercent(value) {
  return `${Math.round(Math.min(MAX_IMAGE_ZOOM, Math.max(MIN_IMAGE_ZOOM, Number.isFinite(value) ? value : 1)) * 100)}%`;
}
