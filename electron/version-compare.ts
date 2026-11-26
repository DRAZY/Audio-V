/**
 * Semantic-version comparison for the update check.
 *
 * The core numbers are compared in order, so 0.4.49 is older than 0.5.0. When
 * the cores match, a release is newer than any prerelease of it
 * (0.5.0 > 0.5.0-rc.2), and prereleases compare by their dot-separated
 * identifiers (rc.2 > rc.1).
 */
interface ParsedVersion {
  core: number[];
  prerelease: string[];
}

function parse(version: string): ParsedVersion {
  const [core, ...rest] = version.trim().replace(/^v/u, "").split("+")[0].split("-");
  return {
    core: core.split(".").map((part) => Number.parseInt(part, 10) || 0),
    prerelease: rest.length ? rest.join("-").split(".") : [],
  };
}

function compareIdentifiers(left: string, right: string): number {
  const leftNumeric = /^\d+$/u.test(left);
  const rightNumeric = /^\d+$/u.test(right);
  if (leftNumeric && rightNumeric) return Number(left) - Number(right);
  if (leftNumeric) return -1;
  if (rightNumeric) return 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

export function compareVersions(left: string, right: string): number {
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.core.length, b.core.length); index += 1) {
    const difference = (a.core[index] ?? 0) - (b.core[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  if (!a.prerelease.length || !b.prerelease.length) {
    return Math.sign(b.prerelease.length - a.prerelease.length);
  }
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    if (a.prerelease[index] === undefined) return -1;
    if (b.prerelease[index] === undefined) return 1;
    const difference = compareIdentifiers(a.prerelease[index], b.prerelease[index]);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}
