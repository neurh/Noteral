import { createReactInlineContentSpec } from "@blocknote/react";
import { Link2Off } from "lucide-react";
import { useAppStore } from "../store";
import { KindIcon } from "./KindIcon";
import { PageIcon } from "./PageIcon";

export function PageLinkChip({ pageId }: { pageId: string }) {
  const page = useAppStore((state) => state.pages.find((item) => item.id === pageId));
  const selectPage = useAppStore((state) => state.selectPage);
  if (!page) {
    return (
      <span className="page-link missing" contentEditable={false} title="This page no longer exists">
        <span className="page-link-icon"><Link2Off size={12} /></span>
        <span className="page-link-title">Missing page</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      className="page-link"
      contentEditable={false}
      title={`Open ${page.title}`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void selectPage(page.id);
      }}
    >
      <span className="page-link-icon">
        <PageIcon value={page.icon} size={13} fallback={<KindIcon page={page} size={12} />} />
      </span>
      <span className="page-link-title">{page.title || "Untitled"}</span>
    </button>
  );
}

export const pageLinkSpec = createReactInlineContentSpec(
  {
    type: "pageLink",
    content: "none",
    propSchema: {
      pageId: { default: "" },
    },
  },
  {
    render: ({ inlineContent }) => <PageLinkChip pageId={inlineContent.props.pageId} />,
  },
);
