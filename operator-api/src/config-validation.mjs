const domainPattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))+$/;

export function validateOperatorOrigin(value) {
  if (typeof value !== "string" || value.length > 200) throw new Error("Invalid operator origin");
  let origin;
  try {
    origin = new URL(value);
  } catch {
    throw new Error("Invalid operator origin");
  }
  if (origin.protocol !== "https:"
    || origin.origin !== value
    || origin.username
    || origin.password
    || origin.pathname !== "/"
    || origin.search
    || origin.hash
    || !domainPattern.test(origin.hostname)) {
    throw new Error("Operator origin must be one clean HTTPS origin");
  }
  return origin;
}

export function validateRpIdForOrigin(rpId, originValue) {
  const origin = originValue instanceof URL ? originValue : validateOperatorOrigin(originValue);
  if (typeof rpId !== "string" || !domainPattern.test(rpId) || rpId !== rpId.toLowerCase()) throw new Error("Invalid WebAuthn RP ID");
  if (rpId !== origin.hostname) throw new Error("WebAuthn RP ID must exactly match the operator origin hostname");
  return rpId;
}

export function validateOperatorBoundaryConfiguration({ expectedOrigin, rpId }) {
  const origin = validateOperatorOrigin(expectedOrigin);
  validateRpIdForOrigin(rpId, origin);
  return Object.freeze({ expectedOrigin: origin.origin, rpId });
}
