import { FileText, Folder, Table2 } from "lucide-react";
import { kindOf } from "../store";

/** The default icon for an item that has no custom icon, by its kind. */
export function KindIcon({ page, size = 14 }: { page?: { kind?: string } | null; size?: number }) {
  const kind = page ? kindOf(page) : "page";
  if (kind === "folder") return <Folder size={size} />;
  if (kind === "database") return <Table2 size={size} />;
  return <FileText size={size} />;
}
