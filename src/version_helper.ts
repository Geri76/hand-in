import elysiaPkg from "elysia/package.json" with { type: "json" };
import handinPkg from "../package.json" with { type: "json" };

export const BUN_VERSION = Bun.version;
export const ELYSIA_VERSION = elysiaPkg.version;
export const HANDIN_VERSION = handinPkg.version;
