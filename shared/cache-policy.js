export const publicCachePolicy = Object.freeze({
  data: "hc-data-v1",
  firstAid: "hc-first-aid-v1",
  firstAidPrefix: "hc-first-aid-",
  integrityStateFile: "integrity-state.json",
  shellPrefix: "hc-shell-"
});

export function isOwnedPublicCacheName(name) {
  return name === publicCachePolicy.data
    || name.startsWith(publicCachePolicy.firstAidPrefix)
    || name.startsWith(publicCachePolicy.shellPrefix);
}
