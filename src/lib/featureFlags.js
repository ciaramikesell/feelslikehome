// Server-side release flags. Each one is read from the server environment at
// request time and defaults OFF: unset, empty or any unrecognised value is off,
// so a deployment without the variable behaves exactly as before the feature.
// Pages read the flag and pass the result down as a prop; client components
// never read process.env for these.
//
//   FLH_FLOOR_PLANS=on   Floor Plans on My Homes / Realtor home cards
//                        (docs/floor-plans-ui.md). On Vercel, set it per
//                        environment (Preview first) and redeploy.
const ON_VALUES = new Set(['on', 'true', '1']);

export function isFlagOn(value) {
  return ON_VALUES.has(String(value ?? '').trim().toLowerCase());
}

export function floorPlansEnabled(env = process.env) {
  return isFlagOn(env.FLH_FLOOR_PLANS);
}
