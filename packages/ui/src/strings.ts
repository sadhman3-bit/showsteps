/**
 * Every user-facing string in Trailmark lives here, keyed by area, so the UI can be
 * translated later by swapping this object.
 */
export const strings = {
  app: {
    name: 'Trailmark',
    tagline: 'Show it once. Get a guide, a walkthrough and a runnable procedure.',
  },
  sidePanel: {
    title: 'Trailmark',
    privacyNote: 'Everything stays on this computer. Nothing is uploaded.',
  },
} as const;

export type Strings = typeof strings;
