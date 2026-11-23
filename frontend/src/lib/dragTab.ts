// Cross-pane tab dragging.
//
// HTML5 data transfer does not expose payloads during dragover, and WebKitGTK
// does not expose custom MIME types either. A module-level value therefore
// carries the dragged tab for hover feedback, while the data transfer carries
// it for the actual drop (and as a fallback for odd drag sources).

const TAB_MIME = "application/x-noteral-tab";

let draggingTabId = "";

export function beginTabDrag(tabId: string): void {
  draggingTabId = tabId;
}

export function endTabDrag(): void {
  draggingTabId = "";
}

export function tabDragId(): string {
  return draggingTabId;
}

export function writeTabDrag(dataTransfer: DataTransfer, tabId: string): void {
  dataTransfer.effectAllowed = "move";
  dataTransfer.setData(TAB_MIME, tabId);
  dataTransfer.setData("text/plain", tabId);
}

export function hasTabDrag(dataTransfer: DataTransfer): boolean {
  if (draggingTabId) return true;
  return Array.from(dataTransfer.types).includes(TAB_MIME);
}

export function readTabDrag(dataTransfer: DataTransfer): string {
  return draggingTabId || dataTransfer.getData(TAB_MIME);
}
