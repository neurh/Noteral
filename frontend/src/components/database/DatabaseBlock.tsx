import { createReactBlockSpec } from "@blocknote/react";
import { useMemo } from "react";
import { useAppStore } from "../../store";
import { parseRefs, serializeRefs, type ViewRef } from "../../lib/databaseRefs";
import { DatabaseView } from "./DatabaseView";

function DatabaseEmbed({ databaseId, views, blockId, onRefsChange }: { databaseId: string; views: string; blockId: string; onRefsChange: (refs: ViewRef[]) => void }) {
  const refs = useMemo(() => parseRefs(views), [views]);
  const exists = useAppStore((state) => state.pages.some((page) => page.id === databaseId || refs.some((ref) => ref.db === page.id)));
  if ((!databaseId && !refs.length) || !exists) {
    return <div className="db-missing">This database no longer exists.</div>;
  }
  return <DatabaseView databaseId={databaseId || refs[0].db} inline stateKey={`${databaseId}:${blockId}`} refs={refs} onRefsChange={onRefsChange} ownerId={blockId} />;
}

function DatabaseExport({ databaseId }: { databaseId: string }) {
  const title = useAppStore((state) => state.pages.find((page) => page.id === databaseId)?.title ?? "Database");
  return <a href={`noteral-page://${databaseId}`}>{title}</a>;
}

/**
 * A database embedded in a page. The rows live in the database itself.
 * `views` (JSON list of {db, view}) lets one block show views of several
 * databases; empty means the database's own views.
 */
export const databaseBlockSpec = createReactBlockSpec(
  {
    type: "database",
    propSchema: {
      databaseId: { default: "" },
      views: { default: "" },
    },
    content: "none",
  },
  {
    render: ({ block, editor }) => (
      <div className="db-block" data-database-id={block.props.databaseId}>
        <DatabaseEmbed
          databaseId={block.props.databaseId}
          views={block.props.views}
          blockId={block.id}
          onRefsChange={(refs) => {
            const current = editor.getBlock(block.id);
            if (!current) return;
            editor.updateBlock(current, { props: { views: serializeRefs(refs) } } as never);
          }}
        />
      </div>
    ),
    toExternalHTML: ({ block }) => <DatabaseExport databaseId={block.props.databaseId} />,
  },
);
