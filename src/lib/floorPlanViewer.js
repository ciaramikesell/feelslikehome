// Pure geometry for the floor-plan viewer (FloorPlans.jsx): fit, zoom about a
// point, keep the image on screen, and tell a swipe from a pan. Offsets are in
// CSS pixels from the stage's centre; the image is drawn at its fitted size and
// transformed with translate(x, y) scale(scale) about its own centre.
export const MIN_SCALE = 1;
export const MAX_SCALE = 4;
export const DOUBLE_TAP_SCALE = 2.5;
export const ZOOM_STEP = 1.5;
const SWIPE_DISTANCE = 56;
const DISMISS_DISTANCE = 110;
const FLICK_SPEED = 0.5; // px per ms: a quick short flick still turns the page

export const clampScale = (scale) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number.isFinite(scale) ? scale : MIN_SCALE));

// The image's size at scale 1: contained in the stage, never enlarged past
// its natural size (a small plan stays crisp instead of being blown up).
export function fitSize(stage, natural) {
  if (!stage?.width || !stage?.height || !natural?.width || !natural?.height) return { width: 0, height: 0 };
  const ratio = Math.min(stage.width / natural.width, stage.height / natural.height, 1);
  return { width: natural.width * ratio, height: natural.height * ratio };
}

// No panning past the image's edge; an image smaller than the stage stays centred.
export function clampOffset({ x, y }, scale, stage, fitted) {
  const maxX = Math.max(0, (fitted.width * scale - stage.width) / 2);
  const maxY = Math.max(0, (fitted.height * scale - stage.height) / 2);
  const clamp = (value, max) => (max === 0 ? 0 : Math.min(max, Math.max(-max, value)));
  return { x: clamp(x, maxX), y: clamp(y, maxY) };
}

// Zoom to nextScale keeping `point` (relative to the stage centre) still.
export function zoomAt(view, nextScale, point, stage, fitted) {
  const scale = clampScale(nextScale);
  if (scale === MIN_SCALE) return { scale, x: 0, y: 0 };
  const factor = scale / view.scale;
  const offset = clampOffset({ x: point.x - (point.x - view.x) * factor, y: point.y - (point.y - view.y) * factor }, scale, stage, fitted);
  return { scale, ...offset };
}

export function pan(view, dx, dy, stage, fitted) {
  return { scale: view.scale, ...clampOffset({ x: view.x + dx, y: view.y + dy }, view.scale, stage, fitted) };
}

// A one-finger gesture at scale 1: 'next' / 'prev' (horizontal), 'dismiss'
// (pulled down), or null (too small, or diagonal).
export function classifySwipe(dx, dy, ms = 1000) {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const quick = ms > 0 && ax / ms > FLICK_SPEED && ax > 24;
  if (ax > ay * 1.3 && (ax >= SWIPE_DISTANCE || quick)) return dx < 0 ? 'next' : 'prev';
  if (dy > 0 && ay > ax * 1.3 && ay >= DISMISS_DISTANCE) return 'dismiss';
  return null;
}

// Moving between plans stops at either end (no wrap: "1 of 3" never jumps to 3).
export function stepIndex(index, delta, count) {
  if (!count) return 0;
  return Math.min(count - 1, Math.max(0, index + delta));
}

// Distance and midpoint of two pointers, for pinch.
export function pinchGeometry(a, b) {
  return { distance: Math.hypot(b.x - a.x, b.y - a.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
}

// The card action's text, or null when it has nothing to offer: a viewer
// (Realtor) with no plans sees no action at all. count is null when unknown.
export function floorPlansActionLabel(count, canEdit) {
  if (count === 0) return canEdit ? 'Add floor plan' : null;
  return count > 0 ? `Floor plans (${count})` : 'Floor plans';
}

// Picked files against the room left: the first `room` acceptable images are
// uploaded, the rest are reported (never uploaded, so nothing is left behind).
export function planUploadBatch(files, room, fileError) {
  const accepted = [];
  const rejected = [];
  let overLimit = 0;
  for (const file of files) {
    const problem = fileError(file);
    if (problem) rejected.push({ file, message: problem });
    else if (accepted.length < room) accepted.push(file);
    else overLimit += 1;
  }
  return { accepted, rejected, overLimit };
}
