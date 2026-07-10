// download.ts — trigger a browser download of a URL (or a Blob) under a given
// filename, via a transient anchor click.
export function download(href: string, filename: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.click();
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  download(url, filename);
  // Defer revocation: the anchor's navigation fetches the blob URL
  // asynchronously, and WebKit has raced a synchronous revoke into a silent
  // no-op export. A short delay (the conventional fix) lets the fetch start
  // first.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
