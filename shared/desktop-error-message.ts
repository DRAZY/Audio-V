export function desktopErrorMessage(
  error: unknown,
  fallback: string,
): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const readable = raw
    .replace(
      /^(?:Error:\s*)?Error invoking remote method '[^']+':\s*(?:Error:\s*)?/iu,
      "",
    )
    .replace(/^Error:\s*/iu, "")
    .trim();
  return readable || fallback;
}
