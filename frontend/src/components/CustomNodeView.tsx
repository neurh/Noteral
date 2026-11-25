import { useCallback, useMemo } from "react";
import { Shapes } from "lucide-react";
import { useContributions } from "../lib/contributions";
import { useAppStore } from "../store";
import { ViewFrame } from "./ViewFrame";

/** Stored item data for kind "custom": which node type it is, and that type's own data. */
export interface CustomNodeData {
  type: string;
  data?: unknown;
}

export function parseNodeData(raw: string | undefined): CustomNodeData {
  try {
    const value = JSON.parse(raw || "{}") as Partial<CustomNodeData>;
    return { type: typeof value.type === "string" ? value.type : "", data: value.data };
  } catch {
    return { type: "" };
  }
}

const MAX_NODE_DATA = 1_000_000;

/**
 * The body of a custom tree node: the HTML view its node type registered.
 *
 * layout "full" fills the whole pane and the view owns its scrolling (one scrollbar, the
 * view's). layout "page" sits under the normal page head and grows with its content, so
 * only the page scrolls.
 */
export function CustomNodeView({ pageId }: { pageId: string }) {
  const item = useAppStore((state) => state.pages.find((entry) => entry.id === pageId));
  const raw = item?.data;
  const title = item?.title ?? "";
  const icon = item?.icon ?? "";
  const setPageData = useAppStore((state) => state.setPageData);
  const { nodeTypeMap } = useContributions();
  const node = useMemo(() => parseNodeData(raw), [raw]);
  const def = nodeTypeMap.get(node.type);
  const layout = def?.layout ?? "full";
  const props = useMemo(
    () => ({ data: node.data ?? def?.defaultData ?? null, pageId, title, icon, type: node.type, editable: true, layout }),
    [node, def?.defaultData, pageId, title, icon, layout],
  );

  const onData = useCallback(
    (data: unknown) => {
      const text = JSON.stringify({ type: node.type, data });
      if (text.length > MAX_NODE_DATA) {
        useAppStore.getState().notify("That data is larger than 1 MB and was not saved.", "error");
        return;
      }
      void setPageData(pageId, text);
    },
    [node.type, pageId, setPageData],
  );

  if (!def) {
    return (
      <div className="custom-node-missing">
        <Shapes size={22} aria-hidden="true" />
        <h2>This page type isn't available</h2>
        <p>
          <code>{node.type || "unknown"}</code> comes from a plugin or customization that is turned off or removed. Its data is kept and comes back when the type does.
        </p>
      </div>
    );
  }
  const full = layout === "full";
  return (
    <div className={`custom-node-view is-${layout}`}>
      <ViewFrame
        surface="page"
        viewKey={`${def.key}#${pageId}`}
        html={def.html}
        owner={def.owner}
        permissions={def.permissions}
        props={props}
        fill={full}
        initialHeight={full ? undefined : 320}
        minHeight={full ? 0 : 120}
        maxHeight={full ? undefined : 200_000}
        onData={onData}
        className="custom-node-frame"
        title={def.title}
      />
    </div>
  );
}

/** The node type definition for a stored custom item, for the tree, tabs and page layout. */
export function useNodeType(raw: string | undefined) {
  const { nodeTypeMap } = useContributions();
  return nodeTypeMap.get(parseNodeData(raw).type);
}
