import path from "node:path";

function pathImplementation(platform: NodeJS.Platform): typeof path.posix {
  return platform === "win32" ? path.win32 : path.posix;
}

export function normalizeSourcePath(
  sourcePath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const implementation = pathImplementation(platform);
  return implementation.normalize(implementation.resolve(sourcePath));
}

export function sourcePathKey(
  sourcePath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const normalized = normalizeSourcePath(sourcePath, platform);
  return platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
}
