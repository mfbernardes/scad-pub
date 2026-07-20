// useSignal.ts — F8: the "fire once per genuine value change" idiom used by
// several one-shot external triggers throughout the app (DesignPicker's
// `openSignal`, CustomizeTab's `focusHiddenDiffSignal`, …): a parent bumps a
// monotonically-increasing
// number ("nonce") to ask a descendant to run some action exactly once, and
// the descendant must tell a genuine CHANGE (a fresh signal) apart from the
// value it already had at mount — which may already be a nonzero value left
// over from an earlier interaction this session, so firing on mount itself
// would be wrong. Each call site used to hand-roll this with its own
// `useRef` + `useEffect` pair (see the module docs above for the ones this
// consolidates); this hook is that pattern, written once.
//
// `onFire` is read through a ref — the same latest-callback pattern
// ExportSuccess.tsx and App.tsx's own effects already use — so a caller
// never needs an `eslint-disable-next-line react-hooks/exhaustive-deps` (or
// `react-hooks/set-state-in-effect`) escape hatch just to close over its own
// latest state/props: the effect re-arms only on a genuine `value` change,
// but always *invokes* whatever `onFire` closure was most recently handed to
// it, not a stale one captured when the effect last ran.
//
// Not every nonce-fire call site fits this shape verbatim — QuickStart's own
// `focusParam` nonce carries a payload (the target param name) alongside the
// nonce and composes a multi-step decision (which step to jump to, which
// mode's navigation to use) on top of it; it's left as its own hand-written
// effect rather than forced through this single-number contract.
import { useEffect, useRef } from "react";

export function useSignal(value: number | undefined, onFire: () => void): void {
  const last = useRef(value);
  const onFireRef = useRef(onFire);
  onFireRef.current = onFire;
  useEffect(() => {
    if (value === undefined || value === last.current) return;
    last.current = value;
    onFireRef.current();
  }, [value]);
}
