export function normalizeAccessCode(value: string | undefined): string {
  return (value ?? "").trim();
}

export function isOfficeAccessAllowed(request: Request, accessCode: string): boolean {
  if (!accessCode) return true;
  const authHeader = request.headers.get("authorization") ?? "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "");
  if (timingSafeTextEquals(bearer, accessCode)) return true;
  return timingSafeTextEquals(readBasicAccessCode(authHeader), accessCode);
}

export function officeAccessRequiredResponse(): Response {
  return new Response("AgentRunner Office access required. Use the configured Office access code.", {
    status: 401,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "www-authenticate": 'Basic realm="AgentRunner Office"',
    },
  });
}

function readBasicAccessCode(authHeader: string): string {
  const match = /^Basic\s+(.+)$/i.exec(authHeader);
  if (!match) return "";
  try {
    const decoded = Buffer.from(match[1], "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    return separator >= 0 ? decoded.slice(separator + 1) : decoded;
  } catch {
    return "";
  }
}

function timingSafeTextEquals(left: string, right: string): boolean {
  if (!left || !right || left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}
