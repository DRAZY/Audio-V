import { parentPort, workerData } from "node:worker_threads";
import { createWriteStream } from "node:fs";
import { once } from "node:events";
import { finished } from "node:stream/promises";
import { AuditSessionStore } from "../audit-session-store";
import {
  compactReportFile,
  csvReportHeader,
  csvReportLine,
  writeAuditReport,
} from "../report-exporter";
import type { ReportExportFormat } from "../../shared/contracts";
import type {
  StorageWorkerRequest,
  StorageWorkerResponse,
} from "./storage-worker-protocol";

const port = parentPort;
if (!port) throw new Error("The Audio-V storage worker requires a parent port.");
const data = workerData as { databasePath: string };
const store = new AuditSessionStore(data.databasePath);

async function writeChunk(
  output: ReturnType<typeof createWriteStream>,
  value: string,
): Promise<void> {
  if (!output.write(value)) await once(output, "drain");
}

async function streamSessionReport(
  sessionId: string,
  format: Extract<ReportExportFormat, "json" | "csv">,
  outputPath: string,
): Promise<void> {
  const session = store.getSessionSummary(sessionId);
  if (!session) throw new Error("The requested audit session was not found.");
  const output = createWriteStream(outputPath);
  try {
    if (format === "csv") {
      await writeChunk(output, `${csvReportHeader()}\r\n`);
    } else {
      await writeChunk(
        output,
        `${JSON.stringify({
          schema: "Audio-V authoritative audit report v5",
          exportedAt: new Date().toISOString(),
          source: session.label,
          session: {
            id: session.id,
            status: session.status,
            startedAt: session.startedAt,
            finishedAt: session.finishedAt,
          },
          summary: {
            total: session.completedCount,
            warnings: session.warningCount,
          },
        }).slice(0, -1)},"files":[\n`,
      );
    }
    let offset = 0;
    let first = true;
    while (true) {
      const files = store.getSessionFilesPage(sessionId, offset, 25);
      if (files.length === 0) break;
      for (const file of files) {
        if (format === "csv") {
          await writeChunk(output, `${csvReportLine(file)}\r\n`);
        } else {
          await writeChunk(
            output,
            `${first ? "" : ",\n"}${JSON.stringify(compactReportFile(file))}`,
          );
          first = false;
        }
      }
      offset += files.length;
    }
    if (format === "json") await writeChunk(output, "\n]}\n");
    output.end();
    await finished(output);
  } catch (error) {
    output.destroy();
    throw error;
  }
}

port.on("message", (request: StorageWorkerRequest) => {
  void (async () => {
    switch (request.operation) {
      case "create":
        return store.create(request.source);
      case "recover-interrupted":
        return store.recoverInterruptedSessions();
      case "mark-file-started":
        return store.markFileStarted(request.sessionId, request.filePath);
      case "mark-discovered":
        return store.markDiscovered(request.sessionId, request.count, request.warnings);
      case "store-file":
        return store.storeFile(request.sessionId, request.file, request.ordinal, request.fromCache);
      case "store-files":
        return store.storeFiles(request.sessionId, request.entries);
      case "finish":
        return store.finish(request.sessionId, request.status, request.warnings);
      case "list-sessions":
        return store.listSessions(request.limit);
      case "get-session":
        return store.getSession(request.sessionId, request.compact);
      case "get-session-file":
        return store.getSessionFile(request.sessionId, request.filePath);
      case "get-session-summary":
        return store.getSessionSummary(request.sessionId);
      case "get-recovery-candidates":
        return store.getRecoveryCandidates(request.sessionId);
      case "get-cached":
        return store.getCached(request.filePath);
      case "set-cached":
        return store.setCached(request.file);
      case "find-fingerprints":
        return store.findFingerprintCandidates(
          request.filePath,
          request.limit,
          request.durationSeconds,
        );
      case "list-fingerprint-library":
        return store.listFingerprintLibrary(request.limit);
      case "rebuild-fingerprint-library":
        return store.rebuildFingerprintLibrary();
      case "prune-fingerprint-library":
        return store.pruneMissingFingerprints();
      case "clear-fingerprint-library":
        return store.clearFingerprintLibrary();
      case "update-session-file":
        return store.updateSessionFile(request.sessionId, request.filePath, request.file);
      case "import-legacy":
        return store.importLegacyCache(request.filePath);
      case "export-session": {
        if (request.format === "json" || request.format === "csv") {
          return streamSessionReport(
            request.sessionId,
            request.format,
            request.outputPath,
          );
        }
        const session = store.getSession(request.sessionId);
        if (!session) throw new Error("The requested audit session was not found.");
        return writeAuditReport(
          {
            schema: "Audio-V authoritative audit report v5",
            exportedAt: new Date().toISOString(),
            source: session.label,
            session: {
              id: session.id,
              status: session.status,
              startedAt: session.startedAt,
              finishedAt: session.finishedAt,
            },
            summary: {
              total: session.files.length,
              warnings: session.warningCount,
            },
            files: session.files.map(compactReportFile),
          },
          request.format,
          request.outputPath,
        );
      }
      case "close":
        store.close();
        return true;
    }
  })()
    .then((value) => {
      const response: StorageWorkerResponse = { id: request.id, ok: true, value };
      port.postMessage(response);
    })
    .catch((error: unknown) => {
      const response: StorageWorkerResponse = {
        id: request.id,
        ok: false,
        message: error instanceof Error ? error.message : "Storage operation failed.",
        ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
      };
      port.postMessage(response);
    });
});
