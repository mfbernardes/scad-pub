// Markdown.tsx: a deliberately tiny, safe Markdown renderer for help content
// (no library, no dangerouslySetInnerHTML). Supports the block + inline subset
// the help text needs: blank-line-separated paragraphs, `#`/`##`/`###` ATX
// headings, `- ` bullet lists, and inline **bold**, *italic*, `code`, and
// [text](url) links. Anything else renders as text.
import { createElement, type ReactNode } from "react";
import { safeUrl } from "../lib/safeUrl";

// `#`/`##`/`###` at the start of a single-line block. `#` maps to <h2> so a doc
// heading nests under the modal's own <h1> (DialogTitle) rather than competing.
const HEADING = /^(#{1,3})\s+(.+)$/;

// Inline tokens, one source of truth each. `split()` on the union below
// interleaves matched tokens with the plain text between them, and each branch
// re-tests its OWN anchored pattern rather than sniffing delimiters: a leftover
// "*" or "`" starts and ends with its delimiter without being a token, and a
// startsWith/endsWith test swallowed it into an empty <em>/<code>. Bold stays
// ahead of italic in both the union and the chain, since `**a**` also satisfies
// the italic shape.
//
// Italic may not open or close on whitespace and may not be empty (CommonMark's
// flanking rule); without it `2 * 3 * 4` italicises the middle.
const BOLD = /^\*\*[^*]+\*\*$/;
const ITALIC = /^\*(?![\s*])[^*\n]*[^\s*]\*$/;
const CODE = /^`[^`]+`$/;
const LINK = /^\[([^\]]+)\]\(([^)]+)\)$/;
const INLINE = /(\*\*[^*]+\*\*|\*(?![\s*])[^*\n]*[^\s*]\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/;

function inline(text: string, key: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    const k = `${key}-${i}`;
    if (BOLD.test(part)) return <strong key={k}>{part.slice(2, -2)}</strong>;
    if (ITALIC.test(part)) return <em key={k}>{part.slice(1, -1)}</em>;
    if (CODE.test(part))
      return (
        <code key={k} className="rounded-(--radius-sm) bg-code px-[0.2rem] font-mono text-xs">
          {part.slice(1, -1)}
        </code>
      );
    const link = part.match(LINK);
    if (link) {
      const href = safeUrl(link[2]);
      // Unsafe protocol (e.g. javascript:) -> render the label as plain text.
      if (!href) return <span key={k}>{link[1]}</span>;
      return (
        <a key={k} className="text-link" href={href} target="_blank" rel="noopener noreferrer">
          {link[1]}
        </a>
      );
    }
    return part;
  });
}

/** Render a Markdown-subset string as React nodes (paragraphs + bullet lists). */
export function Markdown({ body }: { body: string }): ReactNode {
  const blocks = body.trim().split(/\n\s*\n/);
  return blocks.map((block, b) => {
    const lines = block.split("\n");
    const heading = lines.length === 1 ? block.match(HEADING) : null;
    if (heading) {
      // `#`->h2, `##`->h3, `###`->h4 (offset by one; see HEADING).
      const tag = `h${heading[1].length + 1}`;
      return createElement(tag, { key: b }, inline(heading[2], `h-${b}`));
    }
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
