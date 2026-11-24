import { readFileSync } from "node:fs";
import {
  type CallableCatalog,
  type CallableDeclaration,
  createStaticCallableCatalog,
} from "@bdp/client";

const CATALOG_URL = new URL("../catalog/issue-callables-preview-1.json", import.meta.url);

/** The Issue document's declarations. The committed catalog is a frozen v0.1-preview
 * artifact (its generator was retired with the v0.1 toolchain; the v0.2 callables are
 * generated under specs/generated/callables/). Read at first use, so a command that calls
 * nothing does not parse them. */
export function issueCallableCatalog(): CallableCatalog {
  return createStaticCallableCatalog(
    () =>
      (
        JSON.parse(readFileSync(CATALOG_URL, "utf8")) as {
          readonly declarations: readonly CallableDeclaration[];
        }
      ).declarations,
  );
}
