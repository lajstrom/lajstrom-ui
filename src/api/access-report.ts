// The access report (docs/spec/rbac.md §14): the admin's, read by the access review alone, out of
// the main chunk.

import { queryOptions } from "@tanstack/react-query";

import { sha256Hex } from "@/lib/sha256";

import { apiGetBytes, apiPath } from "./client";
import type { AccessReport } from "./types";

/** The report of a scope as the server sent it: its bytes, their sha256, which a review names,
 * and the document. Read once, and again only when asked: each read is another document. */
export const accessReportQuery = (scope: "all" | "people" | "systems", unusedDays: number) =>
  queryOptions({
    queryKey: ["access-report", scope, unusedDays],
    queryFn: async ({ signal }) => {
      const bytes = await apiGetBytes(apiPath("access-report"), { scope, unusedDays }, signal);
      return { bytes, sha256: sha256Hex(bytes), report: JSON.parse(new TextDecoder().decode(bytes)) as AccessReport };
    },
    staleTime: Infinity,
    refetchOnMount: false,
  });
