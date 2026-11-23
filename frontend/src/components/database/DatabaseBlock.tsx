import { createReactBlockSpec } from "@blocknote/react";
import { useAppStore } from "../../store";
import { DatabaseView } from "./DatabaseView";

function DatabaseEmbed({ databaseId, blockId }: { databaseId: string; blockId: string }) {
  const exists = useAppStore((state) => state.pages.some((page) => page.id === databaseId));
  if (!databaseId || !exists) {
    return <div className="db-missing">This database no longer exists.</div>;
  }
  return <DatabaseView databaseId={databaseId} inline stateKey={`${databaseId}:${blockId}`} />;
}

function DatabaseExport({ databaseId }: { databaseId: string }) {
  const title = useAppStore((state) => state.pages.find((page) => page.id === databaseId)?.title ?? "Database");
  return <a href={`noteral-page://${databaseId}`}>{title}</a>;
}

/** A database embedded in a page. The rows live in the database itself. */
export const databaseBlockSpec = createReactBlockSpec(
  {
    type: "database",
    propSchema: {
      databaseId: { default: "" },
    },
    content: "none",
  },
  {
    render: ({ block }) => (
      <div className="db-block" data-database-id={block.props.databaseId}>
        <DatabaseEmbed databaseId={block.props.databaseId} blockId={block.id} />
      </div>
    ),
    toExternalHTML: ({ block }) => <DatabaseExport databaseId={block.props.databaseId} />,
  },
);
