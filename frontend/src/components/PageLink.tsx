import { createReactInlineContentSpec } from "@blocknote/react";
import { FileText, Link2Off } from "lucide-react";
import { useAppStore } from "../store";

export function PageLinkChip({ pageId }: { pageId: string }) {
  const page = useAppStore((state) => state.pages.find((item) => item.id === pageId));
  const selectPage = useAppStore((state) => state.selectPage);
  if (!page) {
    return (
      <span className="page-link missing" contentEditable={false} title="This page no longer exists">
        <Link2Off size={12} /> Missing page
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
      <FileText size={12} />
      {page.title}
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
