import { promises as fs } from "node:fs";
import type {
  FlacMd5Integrity,
  StreamTechnicalAnalysis,
} from "../../shared/contracts";
import { runEngine } from "./ffmpeg-runtime";

async function readStoredFlacMd5(filePath: string): Promise<string | null> {
  const handle = await fs.open(filePath, "r");
  try {
    const header = Buffer.alloc(42);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead < header.length || header.toString("ascii", 0, 4) !== "fLaC") {
      return null;
    }
    const metadataType = header[4] & 0x7f;
    const metadataLength = header.readUIntBE(5, 3);
    if (metadataType !== 0 || metadataLength !== 34) return null;
    return header.subarray(26, 42).toString("hex");
  } finally {
    await handle.close();
  }
}

function pcmCodecForDepth(bitDepth: number | null): string | null {
  if (bitDepth === null) return null;
  if (bitDepth <= 8) return "pcm_s8";
  if (bitDepth <= 16) return "pcm_s16le";
  if (bitDepth <= 24) return "pcm_s24le";
  if (bitDepth <= 32) return "pcm_s32le";
  return null;
}

export async function verifyFlacMd5(
  filePath: string,
  technical: StreamTechnicalAnalysis,
  signal?: AbortSignal,
): Promise<FlacMd5Integrity | null> {
  if (technical.codecName !== "flac") return null;
  const storedMd5 = await readStoredFlacMd5(filePath);
  if (storedMd5 === null) return null;
  if (/^0{32}$/.test(storedMd5)) {
    return { storedMd5, calculatedMd5: null, status: "not-stored" };
  }
  const pcmCodec = pcmCodecForDepth(technical.bitsPerRawSample);
  if (!pcmCodec) {
    return { storedMd5, calculatedMd5: null, status: "unsupported-depth" };
  }
  const result = await runEngine("ffmpeg", [
    "-nostdin",
    "-hide_banner",
    "-v",
    "error",
    "-xerror",
    "-err_detect",
    "explode",
    "-i",
    filePath,
    "-map",
    "0:a:0",
    "-vn",
    "-sn",
    "-dn",
    "-c:a",
    pcmCodec,
    "-f",
    "md5",
    "pipe:1",
  ], undefined, signal);
  const calculatedMd5 = /MD5=([a-fA-F0-9]{32})/.exec(
    result.stdout.toString("ascii"),
  )?.[1]?.toLowerCase();
  if (!calculatedMd5) {
    throw new Error("FFmpeg did not return the decoded FLAC PCM MD5.");
  }
  return {
    storedMd5,
    calculatedMd5,
    status: calculatedMd5 === storedMd5 ? "verified" : "mismatch",
  };
}
