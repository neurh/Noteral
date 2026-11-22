import { FileText, Star } from "lucide-react";
import type { PageMeta } from "../lib/api";
import { relativeTime } from "../lib/format";
import { useAppStore } from "../store";
import { PageIcon } from "./PageIcon";

interface PageListProps {
  pages: PageMeta[];
  empty: string;
}

export function PageList({ pages, empty }: PageListProps) {
  const active = useAppStore((state) => state.activePageId);
  const favoriteIds = useAppStore((state) => state.favorites);
  const selectPage = useAppStore((state) => state.selectPage);
  const toggleFavorite = useAppStore((state) => state.toggleFavorite);

  if (pages.length === 0) {
    return <div className="empty-hint small"><p>{empty}</p></div>;
  }
  return (
    <div className="page-list" role="list">
      {pages.map((page) => (
        <div key={page.id} className={`page-list-row ${active === page.id ? "active" : ""}`} role="listitem">
          <button type="button" className="page-list-main" onClick={() => void selectPage(page.id)} title={page.title}>
            <span className="tree-icon" aria-hidden="true"><PageIcon value={page.icon} size={14} fallback={<FileText size={14} />} /></span>
            <span className="page-list-copy">
              <span className="page-list-title">{page.title}</span>
              <span className="page-list-time">{relativeTime(page.updatedAt)}</span>
            </span>
          </button>
          <button
            type="button"
            className={`icon-button tiny favorite-toggle ${favoriteIds.includes(page.id) ? "on" : ""}`}
            aria-label={favoriteIds.includes(page.id) ? `Remove ${page.title} from favorites` : `Add ${page.title} to favorites`}
            aria-pressed={favoriteIds.includes(page.id)}
            title={favoriteIds.includes(page.id) ? "Remove favorite" : "Add favorite"}
            onClick={() => void toggleFavorite(page.id)}
          >
            <Star size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
