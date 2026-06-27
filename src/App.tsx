import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import schemaJson from "./generated/designs.json";
import type { Design, ParamValue, RenderResult } from "./openscad/types";
import { validateSchema } from "./lib/schema";
import { fileSignature, OpenSCADRunner, SupersededError } from "./openscad/runner";
import { toScadExpr } from "./lib/scad";
import {
  defaultsFor,
  fetchBundledPresets,
  listPresets,
  type ParsedSet,
  type Values,
} from "./lib/presets";
import { readInitialState, persistState } from "./lib/urlState";
import { loadFiles, saveFile, deleteFile, clearFiles } from "./lib/fileStore";
import { download, downloadBlob } from "./lib/download";
import { useTheme } from "./lib/theme";
import { useServiceWorkerUpdate } from "./lib/swUpdate";
import { toast } from "sonner";
import { AppShell } from "./components/AppShell";
import { Toaster } from "./components/ui/sonner";
import { LicensesModal } from "./components/LicensesModal";
import { HelpModal } from "./components/HelpModal";
import { PopupModal } from "./components/PopupModal";
import { shouldShowPopup, rememberPopup } from "./lib/popup";

// A render slower than this auto-pauses live re-rendering for the design.
const HEAVY_RENDER_MS = 6000;

const schema = validateSchema(schemaJson);
const initialState = readInitialState(schema);
document.title = schema.title;

const popup = schema.popup ?? null;

export default function App() {
  const { mode: themeMode, resolved: theme, cycle: cycleTheme } = useTheme();
  const {
    updateReady,
    applyUpdate,
    forceUpdate,
    dismiss: dismissUpdate,
  } = useServiceWorkerUpdate();
  const [designId, setDesignId] = useState(initialState.designId);
  const design = useMemo<Design>(
    () => schema.designs.find((d) => d.id === designId)!,
    [designId]
  );
  const [values, setValues] = useState<Values>(initialState.values);
  const [presetSel, setPresetSel] = useState(initialState.preset);
  const [bundledPresets, setBundledPresets] = useState<ParsedSet[]>([]);
  const [userPresets, setUserPresets] = useState<string[]>(() => listPresets(design.id));
  const refreshUserPresets = useCallback(() => setUserPresets(listPresets(design.id)), [design.id]);
  const [userFiles, setUserFiles] = useState<Record<string, Uint8Array>>({});
  const [result, setResult] = useState<RenderResult | null>(null);
  const [rendering, setRendering] = useState(false);
  const [bundleStale, setBundleStale] = useState(false);
  const [renderedKey, setRenderedKey] = useState("");
  const [ready, setReady] = useState(false);
  // Transient user-facing confirmations (export done, link copied, …) go through
  // Sonner toasts, which provide their own polite live region for a11y. A shared
  // id means a new confirmation replaces the previous one instead of stacking.
  const setAnnouncement = useCallback((msg: string) => {
    if (msg) toast(msg, { id: "announcement" });
  }, []);
  const [showLicenses, setShowLicenses] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showPopup, setShowPopup] = useState(() => shouldShowPopup(popup));
  const closePopup = (remember: boolean) => {
    if (remember && popup) rememberPopup(popup);
    setShowPopup(false);
  };
  const [autoRender, setAutoRender] = useState(!design.heavy);
  const autoRenderRef = useRef(autoRender);
  useEffect(() => {
    autoRenderRef.current = autoRender;
  }, [autoRender]);

  const runnerRef = useRef<OpenSCADRunner | null>(null);
  const lastKeyRef = useRef("");
  if (!runnerRef.current)
    runnerRef.current = new OpenSCADRunner({
      onReady: () => setReady(true),
      cacheVersion: schema.renderHash,
    });

  const firstDesignRun = useRef(true);
  useEffect(() => {
    if (firstDesignRun.current) {
      firstDesignRun.current = false;
      return;
    }
    setValues(defaultsFor(design));
    setResult(null);
    setRenderedKey("");
    lastKeyRef.current = "";
    setAutoRender(!design.heavy);
    setPresetSel("");
    setUserPresets(listPresets(design.id));
  }, [design]);

  useEffect(() => {
    const t = setTimeout(() => persistState(design, values, presetSel), 300);
    return () => clearTimeout(t);
  }, [design, values, presetSel]);

  useEffect(() => {
    let active = true;
    setBundledPresets([]);
    fetchBundledPresets(design).then((p) => active && setBundledPresets(p));
    return () => { active = false; };
  }, [design]);

  const setValue = useCallback((name: string, value: ParamValue) =>
    setValues((v) => ({ ...v, [name]: value })), []);

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

  const doRender = useMemo(
    () => async () => {
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
        }
        setResult(r);
        if (!r.ok)
          toast.error("Render failed", {
            id: "render-failed",
            description: `Exit ${r.exitCode}. Open Output for details.`,
          });
        if (r.staleDefines?.length) setBundleStale(true);
        setRendering(false);
        if (r.ok && !r.cached && r.ms > HEAVY_RENDER_MS && autoRenderRef.current) {
          setAutoRender(false);
          setAnnouncement(
            `Large model (${r.ms} ms) — auto-render paused. Click "Render now" after edits.`
          );
        }
      } catch (e) {
        if (e instanceof SupersededError) return;
        lastKeyRef.current = "";
        setRendering(false);
      }
    },
    [design.id, defines, userFiles, renderKey]
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

  useEffect(() => {
    loadFiles().then((f) => {
      if (Object.keys(f).length > 0) setUserFiles((prev) => ({ ...f, ...prev }));
    });
  }, []);

  const exportModel = useCallback(() => {
    if (!result?.ok) return;
    const blob = new Blob([result.stl as BlobPart], { type: `model/${schema.format}` });
    downloadBlob(blob, `${design.id}.${schema.format}`);
    setAnnouncement(`Exported ${design.id}.${schema.format}`);
  }, [result, design.id]);

  const savePng = useCallback((url: string) => {
    download(url, `${design.id}.png`);
    setAnnouncement(`Saved ${design.id}.png`);
  }, [design.id]);

  const addFile = useCallback((name: string, bytes: Uint8Array) => {
    setUserFiles((f) => ({ ...f, [name]: bytes }));
    void saveFile(name, bytes);
    runnerRef.current?.clearCache();
    lastKeyRef.current = "";
    setAnnouncement(`File added: ${name}`);
  }, []);

  const removeFile = useCallback((name: string) => {
    setUserFiles((f) => {
      const next = { ...f };
      delete next[name];
      return next;
    });
    void deleteFile(name);
    runnerRef.current?.clearCache();
    lastKeyRef.current = "";
    setAnnouncement(`File removed: ${name}`);
  }, []);

  const clearImportedFiles = useCallback(() => {
    setUserFiles({});
    void clearFiles();
    runnerRef.current?.clearCache();
    lastKeyRef.current = "";
    setAnnouncement("Imported files cleared");
  }, []);

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      setAnnouncement("Copied share link");
    } catch {
      setAnnouncement("Couldn't copy — copy the URL from the address bar");
    }
  }, []);

  const handleReset = useCallback(() => { setValues(defaultsFor(design)); setPresetSel(""); }, [design]);
  const showHelpModal = useCallback(() => setShowHelp(true), []);
  const showLicensesModal = useCallback(() => setShowLicenses(true), []);

  // Stale-bundle (hard) and service-worker-update (soft) notices as Sonner
  // toasts. Stable ids keep them from stacking; they persist until acted on.
  useEffect(() => {
    if (bundleStale)
      toast.error("This page is running an outdated version. Reload to update.", {
        id: "bundle-stale",
        duration: Infinity,
        action: { label: "Reload", onClick: forceUpdate },
      });
  }, [bundleStale, forceUpdate]);

  useEffect(() => {
    if (updateReady && !bundleStale)
      toast("A new version is available.", {
        id: "sw-update",
        duration: Infinity,
        action: { label: "Reload", onClick: applyUpdate },
        cancel: { label: "Later", onClick: dismissUpdate },
      });
  }, [updateReady, bundleStale, applyUpdate, dismissUpdate]);

  return (
    <>
      {showPopup && popup && <PopupModal popup={popup} onClose={closePopup} />}
      {showHelp && <HelpModal help={schema.help} onClose={() => setShowHelp(false)} />}
      {showLicenses && (
        <LicensesModal extra={schema.licenses} onClose={() => setShowLicenses(false)} />
      )}

      <Toaster theme={theme} />

      <AppShell
        schema={schema}
        design={design}
        designs={schema.designs}
        values={values}
        bundled={bundledPresets}
        userPresets={userPresets}
        selectedPreset={presetSel}
        userFiles={userFiles}
        result={result}
        rendering={rendering}
        ready={ready}
        autoRender={autoRender}
        stalePreview={stalePreview}
        theme={theme}
        themeMode={themeMode}
        onDesignChange={setDesignId}
        onChange={setValue}
        onApplyPreset={setValues}
        onSelectedPresetChange={setPresetSel}
        onPresetsChange={refreshUserPresets}
        onRender={doRender}
        onExport={exportModel}
        onSavePng={savePng}
        onCopyLink={copyLink}
        onReset={handleReset}
        onAddFile={addFile}
        onRemoveFile={removeFile}
        onClearFiles={clearImportedFiles}
        onAutoRenderChange={setAutoRender}
        onCycleTheme={cycleTheme}
        onShowHelp={showHelpModal}
        onShowLicenses={showLicensesModal}
      />
    </>
  );
}
