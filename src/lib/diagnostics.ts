// diagnostics.ts — turn the raw OpenSCAD worker log into friendly, structured
// notices. The designs echo non-fatal tactile-layout advisories (see
// lib/layout_rules.scad and lib/fonts.scad) as `ECHO: "<context>: advisory: …"`,
// and OpenSCAD itself emits `WARNING:` lines (e.g. font substitution). Both are
// worth surfacing above the verbose log so users notice them.
export type DiagnosticLevel = "advisory" | "warning";

export interface Diagnostic {
  level: DiagnosticLevel;
  text: string;
}

export function parseDiagnostics(log: string[]): Diagnostic[] {
  const seen = new Set<string>();
  const out: Diagnostic[] = [];
  const add = (level: DiagnosticLevel, text: string) => {
    const key = `${level}:${text}`;
    if (text && !seen.has(key)) {
      seen.add(key);
      out.push({ level, text });
    }
  };

  for (const line of log) {
    const echo = line.match(/^\[out\]\s*ECHO:\s*"(.*)"\s*$/);
    if (echo && /:\s*advisory:/i.test(echo[1])) {
      // "nameplate: advisory: tactile content sits …" -> "nameplate: tactile content sits …"
      add("advisory", echo[1].replace(/:\s*advisory:\s*/i, ": "));
      continue;
    }
    const warn = line.match(/^\[(?:out|err)\]\s*WARNING:\s*(.*)$/);
    if (warn) add("warning", warn[1].trim());
  }
  return out;
}
