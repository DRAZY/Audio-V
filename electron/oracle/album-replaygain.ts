import { runEngine } from "./ffmpeg-runtime";

function finite(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function measureAlbumReplayGain(
  filePaths: string[],
  signal?: AbortSignal,
): Promise<{ integratedLufs: number; gainDb: number; truePeakDbtp: number | null }> {
  if (filePaths.length < 2) {
    throw new Error("Album ReplayGain requires at least two tracks.");
  }
  if (filePaths.length > 99) {
    throw new Error("One album group cannot exceed 99 tracks.");
  }
  const inputs = filePaths.flatMap((filePath) => ["-i", filePath]);
  const normalized = filePaths.map(
    (_, index) =>
      `[${index}:a:0]aresample=48000,aformat=sample_fmts=fltp[a${index}]`,
  );
  const filter = [
    ...normalized,
    `${filePaths.map((_, index) => `[a${index}]`).join("")}concat=n=${filePaths.length}:v=0:a=1,ebur128=peak=true:framelog=quiet[out]`,
  ].join(";");
  const result = await runEngine(
    "ffmpeg",
    [
      "-nostdin",
      "-hide_banner",
      "-nostats",
      "-v",
      "info",
      ...inputs,
      "-filter_complex",
      filter,
      "-map",
      "[out]",
      "-f",
      "null",
      "-",
    ],
    undefined,
    signal,
  );
  const integratedLufs = finite(
    /Integrated loudness:[\s\S]*?\bI:\s*(-?[\d.]+)\s+LUFS/iu.exec(
      result.stderr,
    )?.[1],
  );
  const truePeakDbtp = finite(
    /True peak:[\s\S]*?\bPeak:\s*(-?[\d.]+)\s+dBFS/iu.exec(
      result.stderr,
    )?.[1],
  );
  if (integratedLufs === null) {
    throw new Error("Album loudness scan did not return integrated LUFS.");
  }
  return {
    integratedLufs,
    gainDb: Number((-18 - integratedLufs).toFixed(2)),
    truePeakDbtp,
  };
}
