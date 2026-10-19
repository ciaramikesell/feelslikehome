'use client';

// Floor Plans (docs/floor-plans-ui.md): the quiet card action and the viewer it
// opens. Up to four images per home, separate from the single cover photo and
// never a Match input. Everything private goes through src/lib/homeFloorPlans.js
// — the database decides who may see, add or remove (owner and co-buyers edit,
// connected Realtors view); this file only reflects what it is told.
//
// Rendered only when the server-side FLH_FLOOR_PLANS flag is on (the pages pass
// `floorPlans`); with it off nothing here mounts, so nothing is read, signed or
// uploaded.
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, DraftingCompass, ImagePlus, LoaderCircle, RefreshCw, Scan, Trash2, X, ZoomIn, ZoomOut } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  FLOOR_PLAN_ACCEPT, FLOOR_PLAN_URL_TTL_SECONDS, MAX_FLOOR_PLANS, FloorPlanError, addFloorPlan, canEditFloorPlans,
  floorPlanFileError, getFloorPlans, removeFloorPlan, signFloorPlanUrls,
} from '@/lib/homeFloorPlans';
import {
  DOUBLE_TAP_SCALE, MAX_SCALE, MIN_SCALE, ZOOM_STEP, classifySwipe, clampOffset, fitSize, floorPlansActionLabel, pan,
  pinchGeometry, planUploadBatch, stepIndex, zoomAt,
} from '@/lib/floorPlanViewer';

// Re-sign two minutes before the 15-minute URLs lapse, while the viewer is open.
const RESIGN_AFTER_MS = (FLOOR_PLAN_URL_TTL_SECONDS - 120) * 1000;
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type="file"]), [tabindex]:not([tabindex="-1"])';

export function FloorPlansAction({ count, canEdit, address, onOpen }) {
  const label = floorPlansActionLabel(count, canEdit);
  if (!label) return null;
  return (
    <button type="button" className="hh-floor-plans-action" onClick={onOpen} aria-haspopup="dialog" aria-label={address ? `${label}, ${address}` : label}>
      <DraftingCompass size={13} aria-hidden="true" /> {label}
    </button>
  );
}

/* ------------------------------- zoomable stage ------------------------------- */

// One plan, fitted to the stage. Pinch or double-tap / double-click to zoom,
// drag to pan while zoomed; at fit, a horizontal swipe moves between plans
// and a pull down closes. Wheel / trackpad zoom on desktop.
//
// Memory: this is the only full-resolution image the viewer ever mounts (the
// plan picker is numbered buttons, not thumbnails, and nothing is preloaded).
// A floor plan decodes at its natural size whatever CSS draws it at — a 48 MP
// scan is ~190 MB of bitmap — so the stage is keyed by plan and, when it
// unmounts (another plan chosen, viewer closed), drops the image's src: WebKit
// cancels a download still in flight and can free the decoded bitmap at once
// instead of keeping it until the node is collected.
function ZoomStage({ plan, alt, controlsRef, onScaleChange, onSwipe, onDismiss, onImageError, onImageLoad }) {
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const image = useRef(null);
  const released = useRef(false);
  // A callback ref, not an effect cleanup: React has already cleared object
  // refs by the time unmount cleanups run, so the node would be gone.
  const imageRef = useCallback((node) => {
    if (node) {
      image.current = node;
      released.current = false;
      return;
    }
    // Late load / error events from a released image are not this plan's
    // failure (a cancelled download fires none, but no engine is relied on).
    released.current = true;
    image.current?.removeAttribute('src');
    image.current = null;
  }, []);
  const [view, setView] = useState({ scale: MIN_SCALE, x: 0, y: 0 });
  const [stage, setStage] = useState({ width: 0, height: 0 });
  const [natural, setNatural] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [follow, setFollow] = useState(null);
  const [gesturing, setGesturing] = useState(false);
  const fitted = fitSize(stage, natural);
  const live = useRef({});
  live.current = { view, stage, fitted };
  const pointers = useRef(new Map());
  const gesture = useRef(null);
  const lastTap = useRef(null);

  useEffect(() => {
    const node = stageRef.current;
    if (!node) return undefined;
    const observer = new ResizeObserver(([entry]) => setStage({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // A different plan starts at fit. A re-signed URL for the same plan keeps
  // the zoom and the image already on screen.
  useEffect(() => {
    setView({ scale: MIN_SCALE, x: 0, y: 0 });
    setLoaded(false);
    setNatural(null);
  }, [plan.id]);

  // Rotation / resize: keep the image inside the new stage.
  useEffect(() => {
    setView((current) => ({ scale: current.scale, ...clampOffset(current, current.scale, stage, fitted) }));
  }, [stage.width, stage.height, fitted.width, fitted.height]);

  useEffect(() => { onScaleChange?.(view.scale); }, [view.scale, onScaleChange]);

  const zoomTo = useCallback((scale, point = { x: 0, y: 0 }) => {
    const { stage: s, fitted: f } = live.current;
    setView((current) => zoomAt(current, scale, point, s, f));
  }, []);

  useEffect(() => {
    if (!controlsRef) return undefined;
    controlsRef.current = {
      zoomIn: () => zoomTo(live.current.view.scale * ZOOM_STEP),
      zoomOut: () => zoomTo(live.current.view.scale / ZOOM_STEP),
      reset: () => zoomTo(MIN_SCALE),
      pan: (dx, dy) => setView((current) => pan(current, dx, dy, live.current.stage, live.current.fitted)),
    };
    return () => { controlsRef.current = null; };
  }, [controlsRef, zoomTo]);

  const local = (event) => {
    const rect = stageRef.current.getBoundingClientRect();
    return { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 };
  };

  // Wheel needs a non-passive listener to keep the page from scrolling, and
  // Safari's own gesture events are cancelled so the page never zooms instead.
  useEffect(() => {
    const node = canvasRef.current;
    if (!node) return undefined;
    const onWheel = (event) => {
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0025));
      const point = local(event);
      setView((current) => zoomAt(current, current.scale * factor, point, live.current.stage, live.current.fitted));
    };
    const cancel = (event) => event.preventDefault();
    node.addEventListener('wheel', onWheel, { passive: false });
    node.addEventListener('gesturestart', cancel);
    node.addEventListener('gesturechange', cancel);
    return () => {
      node.removeEventListener('wheel', onWheel);
      node.removeEventListener('gesturestart', cancel);
      node.removeEventListener('gesturechange', cancel);
    };
  }, [plan.url]);

  const onPointerDown = (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    canvasRef.current?.setPointerCapture?.(event.pointerId);
    const point = local(event);
    pointers.current.set(event.pointerId, point);
    setGesturing(true);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const geometry = pinchGeometry(a, b);
      gesture.current = { type: 'pinch', startDistance: geometry.distance || 1, startMid: geometry.mid, startView: live.current.view };
      setFollow(null);
    } else if (pointers.current.size === 1) {
      gesture.current = { type: 'drag', start: point, last: point, time: event.timeStamp, startScale: live.current.view.scale, moved: false };
    }
  };

  const onPointerMove = (event) => {
    if (!pointers.current.has(event.pointerId)) return;
    const point = local(event);
    pointers.current.set(event.pointerId, point);
    const current = gesture.current;
    if (!current) return;
    const { stage: s, fitted: f } = live.current;
    if (current.type === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const geometry = pinchGeometry(a, b);
      const zoomed = zoomAt(current.startView, current.startView.scale * (geometry.distance / current.startDistance), current.startMid, s, f);
      setView(pan(zoomed, geometry.mid.x - current.startMid.x, geometry.mid.y - current.startMid.y, s, f));
      return;
    }
    if (current.type !== 'drag') return;
    const dx = point.x - current.last.x;
    const dy = point.y - current.last.y;
    current.last = point;
    if (Math.hypot(point.x - current.start.x, point.y - current.start.y) > 6) current.moved = true;
    if (live.current.view.scale > MIN_SCALE) setView((value) => pan(value, dx, dy, s, f));
    else if (current.moved) setFollow({ x: point.x - current.start.x, y: Math.max(0, point.y - current.start.y) });
  };

  const endPointer = (event, cancelled = false) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.delete(event.pointerId);
    const current = gesture.current;
    if (current?.type === 'pinch') {
      // One finger left after a pinch carries on as a pan, never a swipe.
      const [remaining] = [...pointers.current.values()];
      gesture.current = remaining ? { type: 'drag', start: remaining, last: remaining, time: event.timeStamp, startScale: live.current.view.scale, moved: true } : null;
      if (!remaining) setGesturing(false);
      return;
    }
    gesture.current = null;
    setGesturing(false);
    setFollow(null);
    if (!current || cancelled) return;
    const point = local(event);
    if (!current.moved) {
      const previous = lastTap.current;
      if (previous && event.timeStamp - previous.time < 320 && Math.hypot(point.x - previous.x, point.y - previous.y) < 32) {
        lastTap.current = null;
        zoomTo(live.current.view.scale > MIN_SCALE ? MIN_SCALE : DOUBLE_TAP_SCALE, point);
      } else {
        lastTap.current = { ...point, time: event.timeStamp };
      }
      return;
    }
    if (current.startScale !== MIN_SCALE || live.current.view.scale !== MIN_SCALE) return;
    const swipe = classifySwipe(point.x - current.start.x, point.y - current.start.y, event.timeStamp - current.time);
    if (swipe === 'next') onSwipe(1);
    else if (swipe === 'prev') onSwipe(-1);
    else if (swipe === 'dismiss') onDismiss();
  };

  const translateX = view.x + (follow ? follow.x * 0.6 : 0);
  const translateY = view.y + (follow ? follow.y * 0.6 : 0);
  return (
    <div ref={stageRef} className={`hh-fp-stage${view.scale > MIN_SCALE ? ' is-zoomed' : ''}`}>
      {plan.url ? (
        <div
          ref={canvasRef}
          className="hh-fp-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(event) => endPointer(event)}
          onPointerCancel={(event) => endPointer(event, true)}
          onLostPointerCapture={(event) => endPointer(event, true)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imageRef}
            src={plan.url}
            alt={alt}
            draggable={false}
            decoding="async"
            className={`hh-fp-image${loaded ? ' is-loaded' : ''}${gesturing ? ' is-gesturing' : ''}`}
            style={{
              width: fitted.width || undefined,
              height: fitted.height || undefined,
              transform: `translate3d(${translateX}px, ${translateY}px, 0) scale(${view.scale})`,
              opacity: loaded ? (follow?.y ? Math.max(0.35, 1 - follow.y / 400) : 1) : 0,
            }}
            onLoad={(event) => {
              if (released.current) return;
              setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight });
              setLoaded(true);
              onImageLoad?.(plan);
            }}
            onError={() => { if (!released.current) onImageError?.(plan); }}
          />
          {!loaded && <div className="hh-fp-image-loading" role="status"><LoaderCircle size={22} className="hh-fp-spin" aria-hidden="true" /><span className="sr-only">Loading floor plan</span></div>}
        </div>
      ) : null}
    </div>
  );
}

/* ----------------------------------- viewer ----------------------------------- */

export function FloorPlansViewer({ homeId, address, onClose, onCountChange }) {
  const titleId = useId();
  const dialogRef = useRef(null);
  const fileRef = useRef(null);
  const controlsRef = useRef(null);
  const [phase, setPhase] = useState('loading'); // loading | ready | error | unavailable
  const [plans, setPlans] = useState([]);
  const [canEdit, setCanEdit] = useState(false);
  const [signFailed, setSignFailed] = useState(false);
  const [index, setIndex] = useState(0);
  const [scale, setScale] = useState(MIN_SCALE);
  const [upload, setUpload] = useState(null); // { done, total } while adding
  const [removing, setRemoving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState(null); // { tone: 'success' | 'error', text }
  const [broken, setBroken] = useState({}); // plan id -> its signed URL would not load
  const generation = useRef(0);
  const signedAt = useRef(0);
  const retried = useRef(new Set());
  const currentId = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onCountRef = useRef(onCountChange);
  onCountRef.current = onCountChange;
  const busy = Boolean(upload) || removing;
  const current = plans[index] || null;
  currentId.current = current?.id ?? null;

  // Rows, edit access and fresh signed URLs, together. `focusId` selects a
  // plan (the one just added); otherwise the plan on screen stays selected.
  const load = useCallback(async ({ quiet = false, focusId = null } = {}) => {
    const run = ++generation.current;
    if (!quiet) setPhase('loading');
    try {
      const supabase = createClient();
      const [rows, editable] = await Promise.all([getFloorPlans(supabase, homeId), canEditFloorPlans(supabase, homeId)]);
      if (run !== generation.current) return;
      if (rows === null) { setPhase('unavailable'); return; }
      let signed = rows.map((row) => ({ ...row, url: null }));
      let failed = false;
      if (rows.length) {
        try { signed = await signFloorPlanUrls(supabase, rows); } catch { failed = true; }
      }
      if (run !== generation.current) return;
      signedAt.current = Date.now();
      const keep = focusId || currentId.current;
      setPlans(signed);
      setIndex((previous) => {
        const found = keep ? signed.findIndex((plan) => plan.id === keep) : -1;
        return found >= 0 ? found : stepIndex(previous, 0, signed.length);
      });
      setCanEdit(editable);
      setSignFailed(failed);
      setPhase('ready');
      onCountRef.current?.(rows.length);
    } catch {
      if (run !== generation.current) return;
      if (quiet) setNotice({ tone: 'error', text: "We couldn't refresh the floor plans. Check your connection and try again." });
      else setPhase('error');
    }
  }, [homeId]);

  useEffect(() => { load(); return () => { generation.current += 1; }; }, [load]);

  // Signed URLs last 15 minutes: re-sign shortly before, and on return to a
  // tab / app that sat in the background past that point.
  useEffect(() => {
    if (phase !== 'ready' || !plans.length) return undefined;
    const timer = setTimeout(() => load({ quiet: true }), Math.max(0, RESIGN_AFTER_MS - (Date.now() - signedAt.current)));
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - signedAt.current >= RESIGN_AFTER_MS) load({ quiet: true });
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [phase, plans, load]);

  // An image that will not load (expired or revoked URL, network) is re-signed
  // once; if it still fails it says so, with Try again.
  const onImageError = useCallback((plan) => {
    if (retried.current.has(plan.id)) { setBroken((value) => ({ ...value, [plan.id]: true })); return; }
    retried.current.add(plan.id);
    load({ quiet: true });
  }, [load]);
  const onImageLoad = useCallback((plan) => {
    retried.current.delete(plan.id);
    setBroken((value) => (value[plan.id] ? { ...value, [plan.id]: false } : value));
  }, []);
  const retryImages = () => {
    retried.current.clear();
    setBroken({});
    load({ quiet: true });
  };

  const go = useCallback((delta) => {
    setConfirming(false);
    setIndex((value) => stepIndex(value, delta, plans.length));
  }, [plans.length]);

  // Notes clear on their own (errors stay longer); both are announced at once.
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(null), notice.tone === 'success' ? 4000 : 8000);
    return () => clearTimeout(timer);
  }, [notice]);

  /* --------------------------------- dialog --------------------------------- */

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const node = dialogRef.current;
    node?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, []);

  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const confirmingRef = useRef(confirming);
  confirmingRef.current = confirming;
  const goRef = useRef(go);
  goRef.current = go;
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        if (confirmingRef.current) setConfirming(false);
        else onCloseRef.current?.();
        return;
      }
      if (event.key === 'Tab') {
        const items = Array.from(dialogRef.current?.querySelectorAll(FOCUSABLE) || []);
        if (!items.length) { event.preventDefault(); return; }
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        return;
      }
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select')) return;
      const controls = controlsRef.current;
      const zoomed = scaleRef.current > MIN_SCALE;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        if (zoomed && controls) {
          const step = 60;
          controls.pan(event.key === 'ArrowLeft' ? step : event.key === 'ArrowRight' ? -step : 0, event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0);
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          goRef.current(event.key === 'ArrowLeft' ? -1 : 1);
        }
      } else if (event.key === '+' || event.key === '=') { controls?.zoomIn(); }
      else if (event.key === '-' || event.key === '_') { controls?.zoomOut(); }
      else if (event.key === '0') { controls?.reset(); }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, []);
  /* --------------------------------- writes --------------------------------- */

  const pickFiles = () => {
    setNotice(null);
    fileRef.current?.click();
  };

  const addFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (fileRef.current) fileRef.current.value = '';
    if (!files.length || busy) return;
    const room = Math.max(0, MAX_FLOOR_PLANS - plans.length);
    const { accepted, rejected, overLimit } = planUploadBatch(files, room, floorPlanFileError);
    const problems = rejected.map((item) => item.message);
    let limitReached = overLimit > 0;
    let added = 0;
    let lastAdded = null;
    if (accepted.length) {
      setUpload({ done: 0, total: accepted.length });
      const supabase = createClient();
      for (const file of accepted) {
        try {
          // addFloorPlan uploads, then saves the row; a refused save (the
          // fourth slot was just taken, access removed) deletes its upload.
          const plan = await addFloorPlan(supabase, homeId, file);
          added += 1;
          lastAdded = plan.id;
        } catch (error) {
          if (error instanceof FloorPlanError && error.reason === 'limit') { limitReached = true; break; }
          problems.push(error instanceof FloorPlanError ? error.message : "We couldn't add that floor plan — please try again.");
        }
        setUpload((value) => value && { ...value, done: value.done + 1 });
      }
      setUpload(null);
      await load({ quiet: true, focusId: lastAdded });
    }
    const parts = [];
    if (added) parts.push(added === 1 ? 'Floor plan added.' : `${added} floor plans added.`);
    if (limitReached) parts.push(`A home can have up to ${MAX_FLOOR_PLANS} floor plans${added ? ' — the others weren’t added.' : ', so this one wasn’t added.'}`);
    if (problems.length) parts.push([...new Set(problems)].join(' '));
    if (parts.length) setNotice({ tone: !limitReached && !problems.length ? 'success' : 'error', text: parts.join(' ') });
  };

  const removeCurrent = async () => {
    if (!current || busy) return;
    setRemoving(true);
    try {
      const removed = await removeFloorPlan(createClient(), current);
      setNotice(removed ? { tone: 'success', text: 'Floor plan removed.' } : { tone: 'error', text: 'That floor plan was already removed, or you can no longer change floor plans for this home.' });
    } catch {
      setNotice({ tone: 'error', text: "We couldn't remove that floor plan — please try again." });
    } finally {
      setConfirming(false);
      setRemoving(false);
      currentId.current = null;
      await load({ quiet: true });
    }
  };

  /* --------------------------------- render --------------------------------- */

  const unavailableHere = current && (!current.url || broken[current.id]);
  const room = MAX_FLOOR_PLANS - plans.length;
  const uploadLabel = upload ? `Adding ${Math.min(upload.done + 1, upload.total)} of ${upload.total}…` : null;
  const addButton = (extraClass = '') => (
    <button type="button" className={`hh-btn hh-fp-add ${extraClass}`} onClick={pickFiles} disabled={busy || room <= 0}>
      {upload ? <LoaderCircle size={15} className="hh-fp-spin" aria-hidden="true" /> : <ImagePlus size={15} aria-hidden="true" />}
      {uploadLabel || (plans.length ? 'Add another' : 'Add floor plan')}
    </button>
  );

  const viewer = (
    <div className="hh-fp-backdrop">
      <div ref={dialogRef} className="hh-fp-viewer" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header className="hh-fp-header">
          <div className="hh-fp-heading">
            <h2 id={titleId} className="hh-fp-title">Floor plans</h2>
            {address && <p className="hh-fp-subtitle">{address}</p>}
          </div>
          {phase === 'ready' && plans.length > 1 && <p className="hh-fp-counter" aria-live="polite">{index + 1} of {plans.length}</p>}
          <button type="button" className="hh-fp-icon-button hh-fp-close" onClick={onClose} aria-label="Close floor plans">
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <div className="hh-fp-main">
          <div className="hh-fp-notice-region">
            {notice?.tone === 'error' && <p className="hh-fp-notice is-error" role="alert">{notice.text}</p>}
            <p className="hh-fp-notice is-success" role="status" aria-live="polite">{notice?.tone === 'success' ? notice.text : ''}</p>
          </div>
          {phase === 'loading' && (
            <div className="hh-fp-state" role="status"><LoaderCircle size={24} className="hh-fp-spin" aria-hidden="true" /><p>Loading floor plans…</p></div>
          )}
          {phase === 'error' && (
            <div className="hh-fp-state" role="alert">
              <p className="hh-fp-state-title">We couldn’t load the floor plans.</p>
              <p>Check your connection and try again.</p>
              <button type="button" className="hh-btn hh-btn-ghost" onClick={() => load()}><RefreshCw size={14} aria-hidden="true" /> Try again</button>
            </div>
          )}
          {phase === 'unavailable' && (
            <div className="hh-fp-state"><p className="hh-fp-state-title">Floor plans aren’t available yet.</p></div>
          )}
          {phase === 'ready' && plans.length === 0 && (
            <div className="hh-fp-state hh-fp-empty">
              <span className="hh-fp-empty-icon" aria-hidden="true"><DraftingCompass size={26} strokeWidth={1.6} /></span>
              <p className="hh-fp-state-title">No floor plans yet</p>
              {canEdit ? (
                <>
                  <p>Add up to {MAX_FLOOR_PLANS} images of this home’s layout — JPEG, PNG or WebP, up to 10MB each. Everyone on this search can see them.</p>
                  {addButton('is-primary')}
                </>
              ) : (
                <p>When the buyers add floor plans, they’ll appear here.</p>
              )}
            </div>
          )}
          {phase === 'ready' && current && (
            <section className="hh-fp-stage-wrap" aria-roledescription="carousel" aria-label="Floor plans">
              <ZoomStage
                key={current.id}
                plan={broken[current.id] ? { ...current, url: null } : current}
                alt={`Floor plan ${index + 1} of ${plans.length}${address ? ` for ${address}` : ''}`}
                controlsRef={controlsRef}
                onScaleChange={setScale}
                onSwipe={go}
                onDismiss={onClose}
                onImageError={onImageError}
                onImageLoad={onImageLoad}
              />
              {unavailableHere && (
                <div className="hh-fp-state hh-fp-state-overlay" role="alert">
                  <p className="hh-fp-state-title">This floor plan isn’t available right now.</p>
                  <p>{signFailed ? 'We couldn’t reach the server.' : 'It may have just been changed or removed.'}</p>
                  <button type="button" className="hh-btn hh-btn-ghost" onClick={retryImages}><RefreshCw size={14} aria-hidden="true" /> Try again</button>
                </div>
              )}
              {plans.length > 1 && (
                <>
                  <button type="button" className="hh-fp-icon-button hh-fp-nav is-prev" onClick={() => go(-1)} disabled={index === 0} aria-label="Previous floor plan"><ChevronLeft size={22} aria-hidden="true" /></button>
                  <button type="button" className="hh-fp-icon-button hh-fp-nav is-next" onClick={() => go(1)} disabled={index === plans.length - 1} aria-label="Next floor plan"><ChevronRight size={22} aria-hidden="true" /></button>
                </>
              )}
              {!unavailableHere && (
                <div className="hh-fp-zoom" role="group" aria-label="Zoom">
                  <button type="button" className="hh-fp-icon-button" onClick={() => controlsRef.current?.zoomOut()} disabled={scale <= MIN_SCALE} aria-label="Zoom out"><ZoomOut size={18} aria-hidden="true" /></button>
                  <button type="button" className="hh-fp-icon-button" onClick={() => controlsRef.current?.reset()} disabled={scale <= MIN_SCALE} aria-label="Fit to screen"><Scan size={18} aria-hidden="true" /></button>
                  <button type="button" className="hh-fp-icon-button" onClick={() => controlsRef.current?.zoomIn()} disabled={scale >= MAX_SCALE} aria-label="Zoom in"><ZoomIn size={18} aria-hidden="true" /></button>
                </div>
              )}
            </section>
          )}
        </div>

        {phase === 'ready' && plans.length > 0 && (plans.length > 1 || canEdit) && (
          <footer className="hh-fp-footer">
            {/* Numbered, not thumbnails: a thumbnail would have to be the full
                original (no resized variants without paid Storage image
                transformations), downloading and decoding every plan at once. */}
            {plans.length > 1 && (
              <ol className="hh-fp-pages" aria-label="Choose a floor plan">
                {plans.map((plan, i) => (
                  <li key={plan.id}>
                    <button type="button" className={`hh-fp-page${i === index ? ' is-current' : ''}`} onClick={() => { setConfirming(false); setIndex(i); }} aria-label={`Floor plan ${i + 1} of ${plans.length}`} aria-current={i === index ? 'true' : undefined}>
                      {i + 1}
                    </button>
                  </li>
                ))}
              </ol>
            )}
            {canEdit && (
              confirming ? (
                <div className="hh-fp-confirm" role="group" aria-label="Remove floor plan">
                  <p>Remove this floor plan for everyone on this search?</p>
                  <div>
                    <button type="button" className="hh-btn hh-btn-ghost" onClick={() => setConfirming(false)} disabled={removing} autoFocus>Keep it</button>
                    <button type="button" className="hh-btn hh-fp-remove-confirm" onClick={removeCurrent} disabled={removing}>
                      {removing ? <><LoaderCircle size={14} className="hh-fp-spin" aria-hidden="true" /> Removing…</> : 'Remove'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="hh-fp-edit">
                  <span className="hh-fp-room">{plans.length} of {MAX_FLOOR_PLANS} added</span>
                  {current && <button type="button" className="hh-fp-text-button" onClick={() => setConfirming(true)} disabled={busy}><Trash2 size={14} aria-hidden="true" /> Remove</button>}
                  {room > 0 && addButton()}
                </div>
              )
            )}
          </footer>
        )}

        <input
          ref={fileRef}
          type="file"
          accept={FLOOR_PLAN_ACCEPT}
          multiple
          hidden
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => addFiles(event.target.files)}
        />
      </div>
    </div>
  );
  return typeof document === 'undefined' ? null : createPortal(viewer, document.body);
}
