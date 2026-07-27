import { execFileSync } from "node:child_process";
import { promises as fs, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  corpusDirectory,
  corpusPath,
  derivedDirectory,
  ffmpegPath,
  generatedCasesPath,
  readJson,
  recipesPath,
  sha256File,
  validateCorpus,
  validateRecipes,
  writeJson,
} from "./lib/validation-corpus.mjs";

const corpus = await readJson(corpusPath);
const recipes = await readJson(recipesPath);
const validation = validateCorpus(corpus);
validation.errors.push(
  ...validateRecipes(recipes, corpus.policy.minimumCasesPerMaster).errors,
);
if (validation.errors.length) throw new Error(validation.errors.join("\n"));

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

function run(args, executable = bundledFfmpeg) {
  execFileSync(
    executable,
    ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", ...args],
    { stdio: "inherit" },
  );
}

function renderRecipe(recipeId, input, output, workingDirectory) {
  if (recipeId === "native-flac-control") {
    run(["-i", input, "-map_metadata", "-1", "-c:a", "flac", output]);
    return;
  }
  if (recipeId.startsWith("mp3-")) {
    if (!mp3Ffmpeg) {
      return {
        generated: false,
        reason:
          "libmp3lame is not present in the bundled LGPL engine; set AUDIO_V_CORPUS_MP3_FFMPEG_PATH to an approved FFmpeg build that exposes libmp3lame.",
      };
    }
    const bitrate = recipeId.split("-")[1];
    const intermediate = path.join(workingDirectory, `${recipeId}.mp3`);
    run(["-i", input, "-map_metadata", "-1", "-c:a", "libmp3lame", "-b:a", `${bitrate}k`, intermediate], mp3Ffmpeg);
    run(["-i", intermediate, "-map_metadata", "-1", "-c:a", "flac", output]);
    return { generated: true, generator: mp3Ffmpeg };
  }
  if (recipeId.startsWith("aac-")) {
    const bitrate = recipeId.split("-")[1];
    const intermediate = path.join(workingDirectory, `${recipeId}.m4a`);
    run(["-i", input, "-map_metadata", "-1", "-c:a", "aac", "-b:a", `${bitrate}k`, intermediate]);
    run(["-i", intermediate, "-map_metadata", "-1", "-c:a", "flac", output]);
    return;
  }
  if (recipeId === "opus-96-to-flac") {
    const intermediate = path.join(workingDirectory, `${recipeId}.opus`);
    run(["-i", input, "-map_metadata", "-1", "-strict", "experimental", "-c:a", "opus", "-b:a", "96k", intermediate]);
    run(["-i", intermediate, "-map_metadata", "-1", "-c:a", "flac", output]);
    return { generated: true, generator: bundledFfmpeg };
  }
  if (recipeId === "upsample-to-96k") {
    const intermediate = path.join(workingDirectory, "downsampled-44k.flac");
    run(["-i", input, "-map_metadata", "-1", "-ar", "44100", "-c:a", "flac", intermediate]);
    run(["-i", intermediate, "-map_metadata", "-1", "-ar", "96000", "-c:a", "flac", output]);
    return { generated: true, generator: bundledFfmpeg };
  }
  if (recipeId.startsWith("intentional-lowpass-")) {
    const cutoff = recipeId.endsWith("18k") ? "18000" : "16000";
    run(["-i", input, "-map_metadata", "-1", "-af", `lowpass=f=${cutoff}`, "-c:a", "flac", output]);
    return { generated: true, generator: bundledFfmpeg };
  }
  if (recipeId === "hard-clipping-control") {
    run(["-i", input, "-map_metadata", "-1", "-af", "volume=30dB", "-c:a", "flac", output]);
    return { generated: true, generator: bundledFfmpeg };
  }
  if (recipeId === "dual-mono-control") {
    run(["-i", input, "-map_metadata", "-1", "-af", "pan=stereo|c0=c0|c1=c0", "-c:a", "flac", output]);
    return { generated: true, generator: bundledFfmpeg };
  }
  if (recipeId === "truncated-flac-control") {
    const complete = path.join(workingDirectory, ".complete-for-truncation.flac");
    run(["-i", input, "-map_metadata", "-1", "-c:a", "flac", complete]);
    const bytes = readFileSync(complete);
    const removed = Math.max(4096, Math.floor(bytes.length * 0.1));
    writeFileSync(output, bytes.subarray(0, Math.max(128, bytes.length - removed)));
    return { generated: true, generator: bundledFfmpeg };
  }
  throw new Error(`No deterministic generator exists for ${recipeId}.`);
}

const cases = [];
const skippedRecipes = [];
for (const master of corpus.masters) {
  const input = path.join(corpusDirectory, master.file);
  const actualHash = await sha256File(input);
  if (actualHash !== master.sha256) {
    throw new Error(`${master.id}: source-master SHA-256 changed.`);
  }
  const masterOutput = path.join(derivedDirectory, master.id);
  await fs.mkdir(masterOutput, { recursive: true });
  for (const recipe of recipes.recipes) {
    const output = path.join(masterOutput, `${recipe.id}.flac`);
    const generated = renderRecipe(recipe.id, input, output, masterOutput) ?? {
      generated: true,
      generator: bundledFfmpeg,
    };
    if (!generated.generated) {
      skippedRecipes.push({
        masterId: master.id,
        recipeId: recipe.id,
        reason: generated.reason,
      });
      continue;
    }
    cases.push({
      id: `${master.id}:${recipe.id}`,
      masterId: master.id,
      groupId: master.groupId,
      split: master.split,
      file: path.relative(corpusDirectory, output),
      sha256: await sha256File(output),
      recipeId: recipe.id,
      recipeSetVersion: recipes.recipeSetVersion,
      truthClass: recipe.truthClass,
      acceptedClassifications: recipe.acceptedClassifications,
      expected: recipe.expected ?? null,
      generator: path.basename(generated.generator),
    });
  }
}

await writeJson(generatedCasesPath, {
  schema: "Audio-V real-world generated cases v1",
  generatedAt: new Date().toISOString(),
  corpusVersion: corpus.corpusVersion,
  recipeSetVersion: recipes.recipeSetVersion,
  engineGenerator: path.basename(ffmpegPath()),
  skippedRecipes,
  cases,
});
console.log(
  `Generated ${cases.length} validation cases from ${corpus.masters.length} independent masters.`,
);
if (skippedRecipes.length) {
  console.warn(
    `Skipped ${skippedRecipes.length} MP3 case(s): the bundled LGPL engine has no libmp3lame encoder. See docs/VALIDATION_CORPUS.md.`,
  );
}
