export const forbiddenPrivacyResponseHeaders: readonly string[];

export function resolvePublicAssetUrl(resource: string | URL, base: string | URL): URL;

export function createPublicAssetRequest(
  resource: string | URL,
  base: string | URL,
  options?: Readonly<{ signal?: AbortSignal }>
): Request;
