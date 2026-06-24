// presets.ts — OpenSCAD Customizer preset (parameterSets) import/export plus
// browser-local persistence. The on-disk format matches OpenSCAD's own
// `<file>.json` so presets round-trip with the desktop Customizer
// (openscad -p file.json -P "Set name").
import type { Design, ParamValue } from "../openscad/types";
import { fromPresetString, toPresetString } from "./scad";
import { assetUrl } from "./assetUrl";
import { ns } from "./appId";

export interface ParameterSetsFile {
  parameterSets: Record<string, Record<string, string>>;
  fileFormatVersion: string;
}

export type Values = Record<string, ParamValue>;

export function defaultsFor(design: Design): Values {
  const v: Values = {};
  for (const p of design.params) v[p.name] = p.default;
  return v;
}

/** Build a desktop-compatible parameterSets file for one named set. */
export function toParameterSetsFile(
  design: Design,
  setName: string,
  values: Values
): ParameterSetsFile {
  const set: Record<string, string> = {};
  for (const p of design.params)
    set[p.name] = toPresetString(p, values[p.name] ?? p.default);
  return { parameterSets: { [setName]: set }, fileFormatVersion: "1" };
}

export interface ParsedSet {
  name: string;
  values: Values;
}

/** Parse a parameterSets file, coercing string values to the design's types. */
export function parseParameterSetsFile(
  design: Design,
  text: string
): ParsedSet[] {
  const data = JSON.parse(text) as Partial<ParameterSetsFile>;
  if (!data.parameterSets || typeof data.parameterSets !== "object")
    throw new Error("Not an OpenSCAD parameterSets file (missing parameterSets).");
  const byName = new Map(design.params.map((p) => [p.name, p]));
  return Object.entries(data.parameterSets).map(([name, raw]) => {
    const values: Values = defaultsFor(design);
    for (const [k, v] of Object.entries(raw)) {
      const p = byName.get(k);
      if (p) values[k] = fromPresetString(p, String(v));
    }
    return { name, values };
  });
}

/**
 * Load the design's bundled presets (parameterSets JSON shipped with the app).
 * Each file may define several named sets; all are flattened. Missing or broken
 * files are skipped so one bad preset never blocks the others.
 */
export async function fetchBundledPresets(design: Design): Promise<ParsedSet[]> {
  const perFile = await Promise.all(
    design.presets.map(async (path) => {
      try {
        const res = await fetch(assetUrl(`scad/${path}`));
        if (!res.ok) return [];
        return parseParameterSetsFile(design, await res.text());
      } catch {
        return []; // skip a missing/broken bundled preset
      }
    })
  );
  return perFile.flat();
}

// ---- Browser-local preset storage (per design) ----

const KEY = ns("presets.v1");

type Store = Record<string, Record<string, Values>>; // designId -> name -> values

function read(): Store {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") as Store;
  } catch {
    return {};
  }
}

function write(store: Store) {
  localStorage.setItem(KEY, JSON.stringify(store));
}

export function listPresets(designId: string): string[] {
  return Object.keys(read()[designId] ?? {}).sort();
}

export function savePreset(designId: string, name: string, values: Values) {
  const store = read();
  store[designId] = { ...(store[designId] ?? {}), [name]: values };
  write(store);
}

export function loadPreset(designId: string, name: string): Values | null {
  return read()[designId]?.[name] ?? null;
}

export function deletePreset(designId: string, name: string) {
  const store = read();
  if (store[designId]) {
    delete store[designId][name];
    write(store);
  }
}
