import { useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "../../store";
import type { PageMeta } from "../../lib/api";
import {
  parseRowValues,
  parseSchema,
  rowsOf,
  serializeRowValues,
  serializeSchema,
  type DatabaseRow,
  type DatabaseSchema,
  type RowValues,
} from "../../lib/database";

export interface DatabaseApi {
  meta: PageMeta | undefined;
  schema: DatabaseSchema;
  rows: DatabaseRow[];
  /** Applies a change to the latest stored schema (never a stale render copy). */
  updateSchema: (change: (schema: DatabaseSchema) => DatabaseSchema | void) => void;
  setValue: (rowId: string, propertyId: string, value: unknown) => void;
  setValues: (rowId: string, change: (values: RowValues) => RowValues) => void;
  renameRow: (rowId: string, title: string) => void;
  addRow: (values?: RowValues, title?: string) => Promise<PageMeta | null>;
  deleteRows: (rowIds: string[]) => Promise<void>;
  duplicateRow: (rowId: string) => Promise<void>;
  moveRow: (rowId: string, beforeId: string) => Promise<void>;
  openRow: (rowId: string) => void;
}

function latestSchema(databaseId: string): DatabaseSchema {
  const meta = useAppStore.getState().pages.find((page) => page.id === databaseId);
  return parseSchema(meta?.data);
}

export function useDatabase(databaseId: string): DatabaseApi {
  const meta = useAppStore((state) => state.pages.find((page) => page.id === databaseId));
  // Only this database's rows: saving an unrelated page must not re-render it.
  const children = useAppStore(useShallow((state) => state.pages.filter((page) => page.parentId === databaseId)));
  const setPageData = useAppStore((state) => state.setPageData);
  const createItem = useAppStore((state) => state.createItem);
  const renamePage = useAppStore((state) => state.renamePage);
  const trashPage = useAppStore((state) => state.trashPage);
  const duplicatePage = useAppStore((state) => state.duplicatePage);
  const movePage = useAppStore((state) => state.movePage);
  const selectPage = useAppStore((state) => state.selectPage);

  const schema = useMemo(() => parseSchema(meta?.data), [meta?.data]);
  const rows = useMemo(() => rowsOf(children, databaseId), [children, databaseId]);

  const updateSchema = useCallback(
    (change: (schema: DatabaseSchema) => DatabaseSchema | void) => {
      const draft = structuredClone(latestSchema(databaseId));
      const next = change(draft) ?? draft;
      void setPageData(databaseId, serializeSchema(next));
    },
    [databaseId, setPageData],
  );

  const setValues = useCallback(
    (rowId: string, change: (values: RowValues) => RowValues) => {
      const row = useAppStore.getState().pages.find((page) => page.id === rowId);
      if (!row) return;
      const next = change({ ...parseRowValues(row.data) });
      void setPageData(rowId, serializeRowValues(next));
    },
    [setPageData],
  );

  const setValue = useCallback(
    (rowId: string, propertyId: string, value: unknown) => setValues(rowId, (values) => ({ ...values, [propertyId]: value })),
    [setValues],
  );

  return {
    meta,
    schema,
    rows,
    updateSchema,
    setValue,
    setValues,
    renameRow: (rowId, title) => void renamePage(rowId, title),
    addRow: (values = {}, title = "") =>
      createItem("page", databaseId, { open: false, title, data: serializeRowValues(values) }),
    deleteRows: async (rowIds) => {
      for (const id of rowIds) await trashPage(id, { quiet: true });
      if (rowIds.length) useAppStore.getState().notify(rowIds.length === 1 ? "Row moved to trash." : `${rowIds.length} rows moved to trash.`, "info");
    },
    duplicateRow: (rowId) => duplicatePage(rowId, { open: false }),
    moveRow: (rowId, beforeId) => movePage(rowId, databaseId, beforeId),
    openRow: (rowId) => void selectPage(rowId),
  };
}
