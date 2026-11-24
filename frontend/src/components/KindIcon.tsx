import { FileText, Folder, Shapes, Table2 } from "lucide-react";
import { kindOf } from "../store";
import { useNodeType } from "./CustomNodeView";
import { PageIcon } from "./PageIcon";

function CustomKindIcon({ data, size }: { data?: string; size: number }) {
  const def = useNodeType(data);
  return def?.icon ? <PageIcon value={def.icon} size={size} fallback={<Shapes size={size} />} /> : <Shapes size={size} />;
}

/** The default icon for an item that has no custom icon, by its kind (custom nodes use their type's icon). */
export function KindIcon({ page, size = 14 }: { page?: { kind?: string; data?: string } | null; size?: number }) {
  const kind = page ? kindOf(page) : "page";
  if (kind === "folder") return <Folder size={size} />;
  if (kind === "database") return <Table2 size={size} />;
  if (kind === "custom") return <CustomKindIcon data={page?.data} size={size} />;
  return <FileText size={size} />;
}
