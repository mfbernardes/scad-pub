// useRenderPipeline.ts — the render orchestration extracted from App.tsx: owns
// the OpenSCAD runner, the content-stable render key, the debounced
// auto-render loop, the heavy-render brake, and everything a render produces
// (result, rendered values snapshot). App composes it with useFileImports
// (file imports call invalidate()) and forwards the returned state to
// AppShell; nothing here renders UI.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { Design, RenderResult } from "../openscad/types";
import {
  fileSignature,
  OpenSCADRunner,
  SupersededError,
} from "../openscad/runner";
import { toScadExpr } from "./scad";
import type { Values } from "./presets";

export interface RenderPipelineArgs {
  design: Design;
  values: Values;
  userFiles: Record<string, Uint8Array>;
  /** Values snapshot shown before the first render lands (initial URL state). */
  initialValues: Values;
  /** A successful uncached render slower than this pauses auto-render. */
  heavyMs: number;
  /** Runner construction options (content-hash cache version + sizing). */
  runner: {
    cacheVersion?: string;
    cacheSize?: number;
    cacheBytes?: number;
    maxCacheEntryBytes?: number;
    persistentCache?: boolean;
  };
  setAnnouncement: (msg: string) => void;
}

export function useRenderPipeline({
  design,
  values,
  userFiles,
  initialValues,
  heavyMs,
  runner,
  setAnnouncement,
}: RenderPipelineArgs) {
  const [result, setResult] = useState<RenderResult | null>(null);
  const [rendering, setRendering] = useState(false);
  const [bundleStale, setBundleStale] = useState(false);
  const [renderedKey, setRenderedKey] = useState("");
  // The parameter values behind the *current* render, captured when it finishes.
  // The viewer's measurements panel reads these (not the live controls) so its
  // figures only change once a render lands, in step with the measured geometry.
  const [renderedValues, setRenderedValues] = useState<Values>(initialValues);
  const [ready, setReady] = useState(false);
  const [autoRender, setAutoRender] = useState(!design.heavy);
  // Mirrored on every render so async work (doRender) reads the latest value
  // without retriggering the effects that depend on it.
  const autoRenderRef = useRef(autoRender);
  autoRenderRef.current = autoRender;

  const runnerRef = useRef<OpenSCADRunner | null>(null);
  const lastKeyRef = useRef("");
  if (!runnerRef.current)
    // `runner`'s fields are exactly OpenSCADRunner's cache options, so spread them.
    runnerRef.current = new OpenSCADRunner({ onReady: () => setReady(true), ...runner });

  const defines = useMemo(() => {
    const d: Record<string, string> = {};
    for (const p of design.params)
      d[p.name] = toScadExpr(p, values[p.name] ?? p.default);
    return d;
  }, [design, values]);
  // Hash user files only when they change, not on every param edit (it scans
  // every uploaded byte), then fold the cheap signature into the render key.
  const fileSig = useMemo(() => fileSignature(userFiles), [userFiles]);
  const renderKey = useMemo(
    () => JSON.stringify({ d: design.id, defines, f: fileSig }),
    [design.id, defines, fileSig]
  );

  const stalePreview = !autoRender && renderKey !== renderedKey;

  const doRender = useCallback(
    async () => {
      if (renderKey === lastKeyRef.current) return;
      setRendering(true);
      try {
        const r = await runnerRef.current!.render({
          design: design.id,
          defines,
          userFiles,
        });
        lastKeyRef.current = r.ok ? renderKey : "";
        if (r.ok) {
          setReady(true);
          setRenderedKey(renderKey);
          // Snapshot the values this render was built from (defines derives from
          // them, so doRender is recreated whenever they change) for the panel.
          setRenderedValues(values);
        }
        setResult(r);
        if (!r.ok)
          toast.error("Render failed", {
            id: "render-failed",
            description: `Exit ${r.exitCode}. Open Output for details.`,
          });
        if (r.staleDefines?.length) setBundleStale(true);
        setRendering(false);
        if (r.ok && !r.cached && r.ms > heavyMs && autoRenderRef.current) {
          setAutoRender(false);
          setAnnouncement(
            `Large model (${r.ms} ms) — auto-render paused. Click "Render now" after edits.`
          );
        }
      } catch (e) {
        // Superseded: a newer render is already in flight and now owns the
        // spinner state — deliberately do NOT setRendering(false) here, or the
        // indicator would flicker off under the render that replaced this one.
        if (e instanceof SupersededError) return;
        // A hard failure (worker crash, message error) rejects instead of
        // resolving with ok:false — surface it like a failed render rather
        // than silently stopping the spinner over a stale model.
        lastKeyRef.current = "";
        setRendering(false);
        toast.error("Render failed", {
          id: "render-failed",
          description:
            e instanceof Error ? e.message : "Unexpected renderer error.",
        });
      }
    },
    [design.id, defines, userFiles, renderKey, values, heavyMs, setAnnouncement]
  );

  useEffect(() => {
    if (!autoRender) return;
    const t = setTimeout(doRender, 400);
    return () => clearTimeout(t);
  }, [doRender, autoRender]);

  // First view of a design always renders once, even when auto-render is off
  // (e.g. heavy designs), so the user never faces an empty canvas. Fires when the
  // renderer is ready and there's no result yet (initial load or design switch);
  // skipped when auto-render is on, since the effect above already covers it.
  useEffect(() => {
    if (ready && !result && !rendering && !autoRenderRef.current) doRender();
  }, [ready, result, rendering, doRender]);

  useEffect(() => () => runnerRef.current?.dispose(), []);

  // Imported-file changes alter render inputs the key can't fully capture in
  // the persisted tiers: drop both cache tiers and forget the last key so the
  // next doRender always reaches the worker.
  const invalidate = useCallback(() => {
    runnerRef.current?.clearCache();
    lastKeyRef.current = "";
  }, []);

  // A design switch resets everything render-scoped (App resets the
  // value/preset state in the same event).
  const resetForDesign = useCallback((next: Design) => {
    setResult(null);
    setRenderedKey("");
    lastKeyRef.current = "";
    setAutoRender(!next.heavy);
  }, []);

  return {
    result,
    rendering,
    ready,
    renderedValues,
    autoRender,
    setAutoRender,
    stalePreview,
    bundleStale,
    doRender,
    invalidate,
    resetForDesign,
  };
}
