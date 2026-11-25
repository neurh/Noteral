import { useMemo } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { Blocks } from "lucide-react";
import { useContributions } from "../lib/contributions";
import { ViewFrame } from "./ViewFrame";

/** Stored data is a JSON string so BlockNote can keep it as a plain prop. */
export function parseBlockData(raw: string | undefined): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export function serializeBlockData(data: unknown): string {
  if (data === undefined) return "";
  const text = JSON.stringify(data);
  if (text.length > 200_000) throw new Error("Block data is larger than 200 KB.");
  return text;
}

interface CustomBlockBodyProps {
  blockId: string;
  kind: string;
  data: string;
  editable: boolean;
  onData: (data: unknown) => void;
}

function CustomBlockBody({ blockId, kind, data, editable, onData }: CustomBlockBodyProps) {
  const { blockTypeMap } = useContributions();
  const def = blockTypeMap.get(kind);
  const parsed = useMemo(() => parseBlockData(data), [data]);
  const props = useMemo(() => ({ data: parsed ?? def?.defaultData ?? null, blockId, editable, type: kind }), [parsed, def?.defaultData, blockId, editable, kind]);
  if (!def) {
    return (
      <div className="custom-block-missing" contentEditable={false}>
        <Blocks size={15} aria-hidden="true" />
        <span>
          <strong>{kind || "Custom block"}</strong> isn't available. The plugin or customization that adds it is off or removed; the block's data is kept.
        </span>
      </div>
    );
  }
  return (
    <ViewFrame
      surface="block"
      viewKey={`${def.key}#${blockId}`}
      html={def.html}
      owner={def.owner}
      permissions={def.permissions}
      props={props}
      initialHeight={def.height ?? 120}
      minHeight={24}
      maxHeight={2400}
      onData={editable ? onData : undefined}
      className="custom-block-frame"
      title={def.title}
    />
  );
}

/** A block whose look and behaviour come from a plugin or customization layer (an HTML view). */
export const customBlockSpec = createReactBlockSpec(
  {
    type: "custom",
    propSchema: {
      kind: { default: "" },
      data: { default: "" },
    },
    content: "none",
  },
  {
    render: ({ block, editor }) => (
      <div className="custom-block" data-kind={block.props.kind} contentEditable={false}>
        <CustomBlockBody
          blockId={block.id}
          kind={block.props.kind}
          data={block.props.data}
          editable={editor.isEditable}
          onData={(next) => {
            try {
              const current = editor.getBlock(block.id);
              if (current) editor.updateBlock(current, { props: { data: serializeBlockData(next) } } as never);
            } catch {
              // Oversized data is dropped; the view keeps its own state.
            }
          }}
        />
      </div>
    ),
    toExternalHTML: ({ block }) => (
      <div data-noteral-block={block.props.kind} data-data={block.props.data}>
        [{block.props.kind}]
      </div>
    ),
  },
);
