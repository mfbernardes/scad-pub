// fullscreen.ts — whether the Fullscreen API can actually put an element
// fullscreen. False on iOS Safari (iPhone), which only allows <video>
// fullscreen, and inside iframes without the `fullscreen` permission — so the
// viewer's fullscreen control is hidden where it wouldn't work.
export function fullscreenSupported(): boolean {
  return (
    typeof document !== "undefined" &&
    document.fullscreenEnabled === true &&
    typeof document.documentElement.requestFullscreen === "function"
  );
}
