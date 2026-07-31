import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { promises as fs, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  acceptanceEligibilityForCase,
  corpusDirectory,
  corpusPath,
  derivedDirectory,
  externalDatasetsPath,
  ffmpegPath,
  ffprobePath,
  generatedCasesPath,
  readJson,
  recipesPath,
  sha256File,
  validateCorpus,
  validateExternalDatasets,
  validateRecipes,
  writeJson,
} from "./lib/validation-corpus.mjs";

const corpus = await readJson(corpusPath);
const recipes = await readJson(recipesPath);
const externalDatasets = await readJson(externalDatasetsPath);
const validation = validateCorpus(corpus);
validation.errors.push(
  ...validateRecipes(recipes, corpus.policy.minimumCasesPerMaster).errors,
  ...validateExternalDatasets(externalDatasets).errors,
);
if (validation.errors.length) throw new Error(validation.errors.join("\n"));
let priorGenerated = null;
try {
  priorGenerated = await readJson(generatedCasesPath);
} catch {
  // The first corpus generation has no reusable derivative manifest.
}

function hasEncoder(executable, encoder) {
  try {
    return execFileSync(executable, ["-hide_banner", "-encoders"], {
      encoding: "utf8",
    }).includes(` ${encoder} `);
  } catch {
    return false;
  }
}

const bundledFfmpeg = ffmpegPath();
const requestedMp3Ffmpeg =
  process.env.AUDIO_V_CORPUS_MP3_FFMPEG_PATH ?? bundledFfmpeg;
const mp3Ffmpeg = hasEncoder(requestedMp3Ffmpeg, "libmp3lame")
  ? requestedMp3Ffmpeg
  : null;
const vorbisEncoder = hasEncoder(bundledFfmpeg, "libvorbis")
  ? "libvorbis"
  : hasEncoder(bundledFfmpeg, "vorbis")
    ? "vorbis"
    : null;
const versionCache = new Map();
let activeOperations = [];

function executableVersion(executable) {
  if (!versionCache.has(executable)) {
    const firstLine = execFileSync(executable, ["-version"], {
      encoding: "utf8",
    }).split(/\r?\n/u)[0];
    versionCache.set(executable, firstLine);
  }
  return versionCache.get(executable);
}

function safeArgument(argument) {
  const value = String(argument);
  return value.split(corpusDirectory).join("<corpus>");
}

function run(args, executable = bundledFfmpeg) {
  activeOperations.push({
    executable: path.basename(executable),
    version: executableVersion(executable),
    arguments: args.map(safeArgument),
  });
  execFileSync(
    executable,
    ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", ...args],
    { stdio: "inherit" },
  );
}

function audioDuration(filePath) {
  const value = execFileSync(
    ffprobePath(),
    [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath,
    ],
    { encoding: "utf8" },
  ).trim();
  const duration = Number(value);
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

function deterministicWindow(groupId, duration, requestedSeconds) {
  const windowSeconds = duration
    ? Math.min(duration, requestedSeconds)
    : requestedSeconds;
  if (!duration || duration <= requestedSeconds) {
    return { startSeconds: 0, durationSeconds: windowSeconds };
  }
  const fraction =
    Number.parseInt(
      createHash("sha256").update(groupId).digest("hex").slice(0, 8),
      16,
    ) / 0xffffffff;
  return {
    startSeconds: Number(
      (fraction * Math.max(0, duration - requestedSeconds)).toFixed(3),
    ),
    durationSeconds: requestedSeconds,
  };
}

function prepareReferenceWindow(input, output, groupId) {
  const window = deterministicWindow(
    groupId,
    audioDuration(input),
    corpus.policy.analysisWindowSeconds,
  );
  activeOperations = [];
  run([
    "-ss", String(window.startSeconds),
    "-i", input,
    "-t", String(window.durationSeconds),
    "-map_metadata", "-1",
    "-c:a", "flac",
    output,
  ]);
  return { ...window, operations: activeOperations.slice() };
}

function unavailable(reason) {
  return { generated: false, reason };
}

function renderRecipe(recipeId, input, output, workingDirectory) {
  activeOperations = [];
  if (recipeId === "native-flac-control") {
    run(["-i", input, "-map_metadata", "-1", "-c:a", "flac", output]);
  } else if (recipeId === "aac-128-mp3-192-to-flac") {
    if (!mp3Ffmpeg) {
      return unavailable(
        "The double-lossy recipe requires an approved FFmpeg build exposing libmp3lame.",
      );
    }
    const aac = path.join(workingDirectory, `${recipeId}.m4a`);
    const mp3 = path.join(workingDirectory, `${recipeId}.mp3`);
    run(["-i", input, "-map_metadata", "-1", "-c:a", "aac", "-b:a", "128k", aac]);
    run(["-i", aac, "-map_metadata", "-1", "-c:a", "libmp3lame", "-b:a", "192k", mp3], mp3Ffmpeg);
    run(["-i", mp3, "-map_metadata", "-1", "-c:a", "flac", output]);
  } else if (/^mp3-(?:\d+|vbr-v[02])-to-flac$/u.test(recipeId)) {
    if (!mp3Ffmpeg) {
      return unavailable(
        "libmp3lame is not present in the bundled LGPL engine; set AUDIO_V_CORPUS_MP3_FFMPEG_PATH to an approved FFmpeg build that exposes libmp3lame.",
      );
    }
    const intermediate = path.join(workingDirectory, `${recipeId}.mp3`);
    const vbr = recipeId.match(/^mp3-vbr-v([02])-to-flac$/u)?.[1];
    const bitrate = recipeId.match(/^mp3-(\d+)-to-flac$/u)?.[1];
    const encodeArguments = vbr
      ? ["-q:a", vbr]
      : ["-b:a", `${bitrate}k`];
    run(["-i", input, "-map_metadata", "-1", "-c:a", "libmp3lame", ...encodeArguments, intermediate], mp3Ffmpeg);
    run(["-i", intermediate, "-map_metadata", "-1", "-c:a", "flac", output]);
  } else if (/^aac-\d+-to-flac$/u.test(recipeId)) {
    const bitrate = recipeId.match(/^aac-(\d+)-to-flac$/u)[1];
    const intermediate = path.join(workingDirectory, `${recipeId}.m4a`);
    run(["-i", input, "-map_metadata", "-1", "-c:a", "aac", "-b:a", `${bitrate}k`, intermediate]);
    run(["-i", intermediate, "-map_metadata", "-1", "-c:a", "flac", output]);
  } else if (/^opus-\d+-to-flac$/u.test(recipeId)) {
    const bitrate = recipeId.match(/^opus-(\d+)-to-flac$/u)[1];
    const intermediate = path.join(workingDirectory, `${recipeId}.opus`);
    run(["-i", input, "-map_metadata", "-1", "-strict", "experimental", "-c:a", "opus", "-b:a", `${bitrate}k`, intermediate]);
    run(["-i", intermediate, "-map_metadata", "-1", "-c:a", "flac", output]);
  } else if (/^vorbis-q[258]-to-flac$/u.test(recipeId)) {
    if (!vorbisEncoder) {
      return unavailable("The bundled FFmpeg engine has no Vorbis encoder.");
    }
    const quality = recipeId.match(/^vorbis-q([258])-to-flac$/u)[1];
    const intermediate = path.join(workingDirectory, `${recipeId}.ogg`);
    const strict = vorbisEncoder === "vorbis" ? ["-strict", "experimental"] : [];
    run(["-i", input, "-map_metadata", "-1", "-ac", "2", ...strict, "-c:a", vorbisEncoder, "-q:a", quality, intermediate]);
    run(["-i", intermediate, "-map_metadata", "-1", "-c:a", "flac", output]);
  } else if (/^upsample-to-(?:48k|88k|96k|192k)$/u.test(recipeId)) {
    const rates = { "48k": 48000, "88k": 88200, "96k": 96000, "192k": 192000 };
    const target = rates[recipeId.match(/^upsample-to-(.+)$/u)[1]];
    const intermediate = path.join(workingDirectory, `${recipeId}-source-44k.flac`);
    run(["-i", input, "-map_metadata", "-1", "-ar", "44100", "-c:a", "flac", intermediate]);
    run(["-i", intermediate, "-map_metadata", "-1", "-ar", String(target), "-c:a", "flac", output]);
  } else if (/^intentional-lowpass-\d+k$/u.test(recipeId)) {
    const cutoff = Number(recipeId.match(/(\d+)k$/u)[1]) * 1000;
    run(["-i", input, "-map_metadata", "-1", "-af", `lowpass=f=${cutoff}`, "-c:a", "flac", output]);
  } else if (recipeId === "bit-depth-pad-to-24") {
    run(["-i", input, "-map_metadata", "-1", "-sample_fmt", "s32", "-bits_per_raw_sample", "24", "-c:a", "flac", output]);
  } else if (recipeId === "bit-depth-dither-to-16") {
    run(["-i", input, "-map_metadata", "-1", "-af", "aresample=osf=s16:dither_method=triangular", "-sample_fmt", "s16", "-c:a", "flac", output]);
  } else if (recipeId === "hard-clipping-control") {
    run(["-i", input, "-map_metadata", "-1", "-af", "volume=30dB", "-c:a", "flac", output]);
  } else if (recipeId === "dual-mono-control") {
    run(["-i", input, "-map_metadata", "-1", "-af", "pan=stereo|c0=c0|c1=c0", "-c:a", "flac", output]);
  } else if (recipeId === "truncated-flac-control") {
    const complete = path.join(workingDirectory, ".complete-for-truncation.flac");
    run(["-i", input, "-map_metadata", "-1", "-c:a", "flac", complete]);
    const bytes = readFileSync(complete);
    const removed = Math.max(4096, Math.floor(bytes.length * 0.1));
    writeFileSync(output, bytes.subarray(0, Math.max(128, bytes.length - removed)));
    activeOperations.push({
      executable: "node",
      version: process.version,
      arguments: [
        "truncate-tail",
        `removed-bytes=${removed}`,
        "input=<corpus>/.complete-for-truncation.flac",
        `output=${safeArgument(output)}`,
      ],
    });
  } else {
    throw new Error(`No deterministic generator exists for ${recipeId}.`);
  }
  return {
    generated: true,
    operations: activeOperations.slice(),
  };
}

const cases = [];
const skippedRecipes = [];
let reusedCases = 0;
const priorCases = new Map(
  priorGenerated?.recipeSetVersion === recipes.recipeSetVersion
    ? (priorGenerated.cases ?? []).map((item) => [item.id, item])
    : [],
);
for (const master of corpus.masters) {
  const input = path.join(corpusDirectory, master.file);
  const actualHash = await sha256File(input);
  if (actualHash !== master.sha256) {
    throw new Error(`${master.id}: external reference SHA-256 changed.`);
  }
  const masterOutput = path.join(derivedDirectory, master.id);
  await fs.mkdir(masterOutput, { recursive: true });
  const windowPath = path.join(masterOutput, ".reference-window.flac");
  const referenceWindow = prepareReferenceWindow(
    input,
    windowPath,
    master.groupId,
  );
  const originDetectorEligibility =
    master.dataset?.role === "controlled-source" &&
    master.technical.sampleRate >= 44100
      ? "positive-and-negative"
      : master.dataset?.role === "edge-control" ||
          master.technical.sampleRate < 32000
        ? "edge-abstention"
        : "negative-only";
  for (const recipe of recipes.recipes) {
    const caseId = `${master.id}:${recipe.id}`;
    const output = path.join(masterOutput, `${recipe.id}.flac`);
    const priorCase = priorCases.get(caseId);
    let generated = null;
    let outputHash = null;
    if (
      priorCase?.sourceSha256 === master.sha256 &&
      priorCase?.recipeSetVersion === recipes.recipeSetVersion
    ) {
      try {
        outputHash = await sha256File(output);
        if (outputHash === priorCase.sha256) {
          generated = {
            generated: true,
            operations: priorCase.operations,
          };
          reusedCases += 1;
        } else {
          outputHash = null;
        }
      } catch {
        // A missing or changed derivative is regenerated below.
      }
    }
    generated ??= renderRecipe(
      recipe.id,
      windowPath,
      output,
      masterOutput,
    );
    if (!generated.generated) {
      skippedRecipes.push({
        masterId: master.id,
        datasetId: master.dataset?.id ?? "manual-import",
        recipeId: recipe.id,
        reason: generated.reason,
      });
      continue;
    }
    outputHash ??= await sha256File(output);
    cases.push({
      id: caseId,
      masterId: master.id,
      sourceSha256: master.sha256,
      groupId: master.groupId,
      datasetId: master.dataset?.id ?? "manual-import",
      sourceCategory: master.dataset?.category ?? "unspecified",
      sourceStratum: master.dataset?.stratum ?? "unspecified",
      originDetectorEligibility,
      acceptanceEligibility: acceptanceEligibilityForCase(
        originDetectorEligibility,
        recipe.truthClass,
      ),
      split: master.split,
      file: path.relative(corpusDirectory, output),
      sha256: outputHash,
      referenceWindow: {
        startSeconds: referenceWindow.startSeconds,
        durationSeconds: referenceWindow.durationSeconds,
        preparation: referenceWindow.operations,
      },
      recipeId: recipe.id,
      recipeSetVersion: recipes.recipeSetVersion,
      truthClass: recipe.truthClass,
      acceptedClassifications:
        originDetectorEligibility === "edge-abstention" &&
        recipe.acceptedClassifications.length > 0
          ? [
              ...new Set([
                ...recipe.acceptedClassifications,
                "inconclusive",
                "not-assessed",
              ]),
            ]
          : recipe.acceptedClassifications,
      expected: recipe.expected ?? null,
      operations: generated.operations,
    });
  }
}

await writeJson(generatedCasesPath, {
  schema: "Audio-V real-world generated cases v2",
  generatedAt: new Date().toISOString(),
  corpusVersion: corpus.corpusVersion,
  registryVersion: externalDatasets.registryVersion,
  recipeSetVersion: recipes.recipeSetVersion,
  engineGenerator: {
    executable: path.basename(bundledFfmpeg),
    version: executableVersion(bundledFfmpeg),
  },
  analysisWindowSeconds: corpus.policy.analysisWindowSeconds,
  reusedCases,
  skippedRecipes,
  cases,
});
console.log(
  `Generated ${cases.length} validation cases from ${corpus.masters.length} independent references (${reusedCases} hash-verified reuse(s)).`,
);
if (skippedRecipes.length) {
  console.warn(
    `Skipped ${skippedRecipes.length} unavailable transformation case(s); reasons are recorded in generated/cases.json.`,
  );
}
