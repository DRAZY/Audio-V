const defaultPolicy = {
  attempts: 4,
  baseDelayMs: 2_000,
  timeoutMs: 120_000,
};

export async function fetchWithRetry(
  url,
  options = {},
  policy = {},
) {
  const {
    attempts,
    baseDelayMs,
    timeoutMs,
    fetchImplementation = fetch,
    wait = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  } = { ...defaultPolicy, ...policy };
  let finalError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImplementation(url, {
        ...options,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (
        response.ok ||
        (response.status < 500 &&
          response.status !== 408 &&
          response.status !== 429)
      ) {
        return response;
      }
      finalError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      finalError = error;
    }
    if (attempt < attempts) {
      const delay = baseDelayMs * 2 ** (attempt - 1);
      console.warn(
        `Download attempt ${attempt}/${attempts} failed for ${url}: ${finalError instanceof Error ? finalError.message : String(finalError)}. Retrying in ${delay} ms.`,
      );
      await wait(delay);
    }
  }

  throw new Error(
    `Download failed after ${attempts} attempts: ${url}`,
    { cause: finalError },
  );
}
