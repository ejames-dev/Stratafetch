import { readFile, writeFile } from "node:fs/promises";
import { format } from "prettier";
import { buildOpenApi } from "../apps/api/dist/openapi.js";
const output = await format(JSON.stringify(buildOpenApi()), { parser: "json" });
const path = new URL("../openapi.json", import.meta.url);
if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = await readFile(path, "utf8");
  } catch {}
  if (current !== output) {
    console.error("openapi.json is stale. Run npm run openapi:generate.");
    process.exit(1);
  }
} else await writeFile(path, output);
