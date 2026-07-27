import { readFile } from "node:fs/promises";

const eventPath = process.env.GITHUB_EVENT_PATH;
if (!eventPath) {
  console.log("Contributor policy check skipped outside a GitHub event.");
  process.exit(0);
}
const event = JSON.parse(await readFile(eventPath, "utf8"));
if (!event.pull_request) {
  console.log("Contributor policy check skipped for a non-pull-request event.");
  process.exit(0);
}
const body = event.pull_request.body ?? "";
const accepted =
  /-\s*\[[xX]\]\s*I have read and agree to the Audio-V Contributor License Agreement v1\.0/u.test(
    body,
  );
if (!accepted) {
  console.error(
    "The pull request must record acceptance of Audio-V Contributor License Agreement v1.0 using the repository pull-request checkbox.",
  );
  process.exitCode = 1;
} else {
  console.log("Contributor License Agreement v1.0 acceptance recorded.");
}
