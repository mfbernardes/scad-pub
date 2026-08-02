// limits.ts: the one practical bound the pipeline advertises, in its own module
// so `check` can raise it as a finding without importing the barrel it is
// itself re-exported from.

/** More colour regions than this tends to print unreliably: small regions merge
 *  or drop out in a slicer. A caution, never a hard limit — the pipeline still
 *  produces every region. */
export const MAX_RELIABLE_REGIONS = 8;
