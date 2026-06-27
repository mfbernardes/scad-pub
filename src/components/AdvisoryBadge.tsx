// AdvisoryBadge.tsx — compact ⚠ N badge shown when the OpenSCAD log has
// notices/warnings/asserts worth the user's attention. Clicking it opens the
// Output console. The count is computed once by the parent (see AppShell) so
// it stays in sync with the output-console toggle badge.
interface Props {
  count: number;
  onClick: () => void;
  className?: string;
}

export function AdvisoryBadge({ count, onClick, className = "" }: Props) {
  if (count === 0) return null;

  return (
    <button
      className={`advisory-badge ${className}`.trim()}
      onClick={onClick}
      aria-label={`${count} ${count === 1 ? "notice" : "notices"} — open output console`}
      title="Open output console"
    >
      ⚠ {count}
    </button>
  );
}
