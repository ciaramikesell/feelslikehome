import { normalizeSearchIntent } from './searchIntent.js';

// Temporary pre-beta switch. Turn this off to remove every feedback entry point
// without changing the database or deployment environment.
export const BETA_FEEDBACK_ENABLED = true;
export const BETA_FEEDBACK_MESSAGE_MAX = 2000;
export const BETA_FEEDBACK_TYPES = Object.freeze(['broken', 'confusing', 'idea']);

export function shouldShowBetaFeedback(enabled = BETA_FEEDBACK_ENABLED) {
  return enabled === true;
}

export function deviceClassForWidth(width) {
  if (!Number.isFinite(width)) return null;
  if (width < 640) return 'mobile';
  if (width < 1024) return 'tablet';
  return 'desktop';
}

export function homeIdFromPathname(pathname) {
  const match = typeof pathname === 'string' ? pathname.match(/^\/homes\/([0-9a-f-]{36})\/?$/i) : null;
  return match?.[1] || null;
}

// Deliberately allowlisted. Never pass a component object or arbitrary page state
// into this helper: private notes, priorities, form values, and auth data have no
// place in the returned persistence payload.
export function buildBetaFeedbackPayload({
  userId,
  pathname,
  searchId = null,
  homeId = null,
  searchType = null,
  feedbackType = null,
  message,
  isBlocking = false,
  viewport = {},
  userAgent = null,
  appVersion = null,
}) {
  const width = Number.isFinite(viewport.width) ? Math.round(viewport.width) : null;
  const height = Number.isFinite(viewport.height) ? Math.round(viewport.height) : null;
  return {
    user_id: userId,
    search_id: searchId || null,
    home_id: homeId || homeIdFromPathname(pathname),
    route: pathname || '/',
    search_intent: normalizeSearchIntent(searchType),
    feedback_type: BETA_FEEDBACK_TYPES.includes(feedbackType) ? feedbackType : null,
    message: message.trim(),
    is_blocking: Boolean(isBlocking),
    viewport_width: width,
    viewport_height: height,
    device_class: deviceClassForWidth(width),
    user_agent: typeof userAgent === 'string' ? userAgent.slice(0, 1024) : null,
    app_version: typeof appVersion === 'string' && appVersion ? appVersion.slice(0, 255) : null,
    screenshot_path: null,
  };
}

export async function submitBetaFeedback(supabase, payload) {
  const { error } = await supabase.from('beta_feedback').insert(payload);
  if (error) throw error;
}
