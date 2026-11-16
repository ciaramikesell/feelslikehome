import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { isNativePluginAvailable } from '@/lib/platform';

// Short native haptics for real selection/confirmation moments only — never
// for page navigation, scrolling or decoration. Each call is fire-and-forget:
// outside the native shell, on an installed build that predates the Haptics
// plugin, or with iOS System Haptics turned off, it does nothing and never
// throws. (iOS itself honours the person's System Haptics setting.)
function run(effect) {
  if (!isNativePluginAvailable('Haptics')) return;
  try {
    Promise.resolve(effect()).catch(() => {});
  } catch {
    // A missing or failing haptic engine must never break the tap it decorates.
  }
}

// Choosing something (a tile, an option).
export function selectionHaptic() {
  run(() => Haptics.selectionChanged());
}

// Pressing the one highlighted action in a step.
export function confirmHaptic() {
  run(() => Haptics.impact({ style: ImpactStyle.Light }));
}

// A small success moment (e.g. a home saved).
export function successHaptic() {
  run(() => Haptics.notification({ type: NotificationType.Success }));
}
