export const signedArtifacts = Object.freeze([
  { path: "directory.json", sequence: 2 },
  { path: "bootstrap.json", sequence: 1 },
  { path: "regions/demo-north.min.json", sequence: 1 },
  { path: "regions/demo-north.v3.min.json", sequence: 3 },
  { path: "regions/demo-south.min.json", sequence: 1 },
  { path: "regions/demo-south.v4.min.json", sequence: 4 },
  { path: "updates/index.json", sequence: 4 },
  { path: "updates/demo-north.1-2.delta.json", sequence: 2 },
  { path: "updates/demo-north.2-3.delta.json", sequence: 3 },
  { path: "updates/demo-south.3-4.delta.json", sequence: 4 },
  { path: "first-aid/fr.json", sequence: 1 },
  { path: "first-aid/en.json", sequence: 1 },
  { path: "first-aid/ur.json", sequence: 1 }
]);

export const trustAssets = Object.freeze(["trust/keyring.json", "trust/keyring.json.sig.json"]);
export const signatureAssets = Object.freeze(signedArtifacts.map((artifact) => `${artifact.path}.sig.json`));
