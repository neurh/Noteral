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

/** The body of a custom tree node: the HTML view its node type registered, full height. */
export function CustomNodeView({ pageId }: { pageId: string }) {
  const raw = useAppStore((state) => state.pages.find((item) => item.id === pageId)?.data);
  const title = useAppStore((state) => state.pages.find((item) => item.id === pageId)?.title ?? "");
  const setPageData = useAppStore((state) => state.setPageData);
  const { nodeTypeMap } = useContributions();
  const node = useMemo(() => parseNodeData(raw), [raw]);
  const def = nodeTypeMap.get(node.type);
  const props = useMemo(() => ({ data: node.data ?? def?.defaultData ?? null, pageId, title, type: node.type, editable: true }), [node, def?.defaultData, pageId, title]);

  const onData = useCallback(
    (data: unknown) => {
      const text = JSON.stringify({ type: node.type, data });
      if (text.length > 1_000_000) {
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
        <h2>This node type isn't available</h2>
        <p>
          <code>{node.type || "unknown"}</code> comes from a plugin or customization that is turned off or removed. Its data is kept and comes back when the type does.
        </p>
      </div>
    );
  }
  return (
    <div className="custom-node-view">
      <ViewFrame
        viewKey={`${def.key}#${pageId}`}
        html={def.html}
        owner={def.owner}
        permissions={def.permissions}
        props={props}
        fill
        onData={onData}
        className="custom-node-frame"
        title={def.title}
      />
    </div>
  );
}

/** Icon and title of a custom node's type, for the tree and tabs. */
export function useNodeType(raw: string | undefined) {
  const { nodeTypeMap } = useContributions();
  return nodeTypeMap.get(parseNodeData(raw).type);
}
