// Markdown.tsx — a deliberately tiny, safe Markdown renderer for help content
// (no library, no dangerouslySetInnerHTML). Supports the block + inline subset
// the help text needs: blank-line-separated paragraphs, `- ` bullet lists, and
// inline **bold**, `code`, and [text](url) links. Anything else renders as text.
import type { ReactNode } from "react";

// Inline: **bold**, `code`, [text](url). Split on the first matching token,
// recurse on the rest. Order matters only for disjoint tokens, so a single pass
// with a combined regex is enough.
const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/;

function inline(text: string, key: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    const k = `${key}-${i}`;
    if (part.startsWith("**") && part.endsWith("**"))
      return <strong key={k}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`"))
      return <code key={k}>{part.slice(1, -1)}</code>;
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link)
      return (
        <a key={k} href={link[2]} target="_blank" rel="noopener noreferrer">
          {link[1]}
        </a>
      );
    return part;
  });
}

/** Render a Markdown-subset string as React nodes (paragraphs + bullet lists). */
export function Markdown({ body }: { body: string }): ReactNode {
  const blocks = body.trim().split(/\n\s*\n/);
  return blocks.map((block, b) => {
    const lines = block.split("\n");
    if (lines.every((l) => l.trim().startsWith("- "))) {
      return (
        <ul key={b}>
          {lines.map((l, i) => (
            <li key={i}>{inline(l.trim().slice(2), `${b}-${i}`)}</li>
          ))}
        </ul>
      );
    }
    return <p key={b}>{inline(block.replace(/\n/g, " "), String(b))}</p>;
  });
}
