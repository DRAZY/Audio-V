import { promises as fs } from "node:fs";
import path from "node:path";

const root = path.join(process.cwd(), "node_modules");
const marker = "// Audio-V CommonJS compatibility adapter";
const expectedVersion = "5.0.9";
const adapter = `
${marker}
module.exports = Object.assign(expand, {
  expand,
  EXPANSION_MAX: exports.EXPANSION_MAX,
  EXPANSION_MAX_LENGTH: exports.EXPANSION_MAX_LENGTH,
});
`;
let patched = 0;

async function visit(directory) {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === ".bin") continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.name === "brace-expansion") {
      const packagePath = path.join(entryPath, "package.json");
      try {
        const metadata = JSON.parse(await fs.readFile(packagePath, "utf8"));
        if (metadata.version !== expectedVersion) {
          throw new Error(
            `Expected patched brace-expansion ${expectedVersion}, found ${metadata.version}.`,
          );
        }
        const commonJsPath = path.join(entryPath, "dist", "commonjs", "index.js");
        const source = await fs.readFile(commonJsPath, "utf8");
        const original = source.includes(marker)
          ? source.slice(0, source.indexOf(marker)).trimEnd()
          : source.trimEnd();
        await fs.writeFile(commonJsPath, `${original}\n${adapter}`);
        patched += 1;
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
          continue;
        }
        throw error;
      }
      continue;
    }
    await visit(entryPath);
  }
}

await visit(root);
if (patched === 0) {
  throw new Error(
    `No brace-expansion ${expectedVersion} installation was found to adapt.`,
  );
}
console.log(
  `Applied callable CommonJS compatibility to ${patched} patched brace-expansion installation${patched === 1 ? "" : "s"}.`,
);
