/**
 * Re-export shim. All real content lives in `./api/`.
 * This file exists so existing `import { api, fmtNum, ... } from "@/lib/api"`
 * callers keep working — they will resolve to `./api/index.ts` via TS path
 * resolution once we delete this file, but the shim stays for one release
 * to keep the diff reviewable.
 */
export * from "./api/index";
