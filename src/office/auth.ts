export const OFFICE_SESSION_COOKIE = "agentrunner_office_session";

export function normalizeOfficeSecret(value: string | undefined): string {
  return (value ?? "").trim();
}

export function timingSafeTextEquals(left: string, right: string): boolean {
  if (!left || !right || left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

export function readCookie(request: Request, name: string): string {
  const cookieHeader = request.headers.get("cookie") ?? "";
  for (const entry of cookieHeader.split(";")) {
    const [key, ...rest] = entry.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

export function isOfficeRequestAllowed(request: Request, secret: string): boolean {
  if (!secret) return true;
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (timingSafeTextEquals(bearer, secret)) return true;
  return timingSafeTextEquals(readCookie(request, OFFICE_SESSION_COOKIE), secret);
}

export function officeSessionHeaders(secret: string): HeadersInit {
  return {
    "set-cookie": `${OFFICE_SESSION_COOKIE}=${encodeURIComponent(secret)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`,
  };
}

export function clearOfficeSessionHeaders(): HeadersInit {
  return {
    "set-cookie": `${OFFICE_SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
  };
}
