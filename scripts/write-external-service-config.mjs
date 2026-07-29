import { promises as fs } from "node:fs";
import path from "node:path";

const outputPath = path.join(process.cwd(), "build", "external-services.json");
const requestedKey = process.env.AUDIO_V_ACOUSTID_CLIENT_KEY?.trim() ?? "";
if (requestedKey && !/^[A-Za-z0-9]{10}$/u.test(requestedKey)) {
  throw new Error(
    "AUDIO_V_ACOUSTID_CLIENT_KEY must be the 10-character key from the registered Audio-V AcoustID application.",
  );
}
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(
  outputPath,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      acoustIdClientKey: requestedKey || null,
      generatedAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
  { encoding: "utf8", mode: 0o600 },
);
console.log(
  requestedKey
    ? "Wrote external service configuration with an official AcoustID client identity."
    : "Wrote external service configuration without an official AcoustID client identity.",
);
