import type { RuntimeStore } from "../db/runtime-store";
import { buildOfficeBridgePayload, buildOfficeSnapshot } from "../dashboard/office-model";
import {
  clearOfficeSessionHeaders,
  isOfficeRequestAllowed,
  normalizeOfficeSecret,
  officeSessionHeaders,
  timingSafeTextEquals,
} from "./auth";
import { renderLoginHtml, renderOfficeHtml } from "./html";

export interface OfficeServerOptions {
  store: RuntimeStore;
  host: string;
  port: number;
  accessCode?: string;
}

export interface OfficeRequestOptions {
  accessCode?: string;
}

export function startOfficeServer(options: OfficeServerOptions): void {
  const accessCode = normalizeOfficeSecret(options.accessCode);
  const server = Bun.serve({
    hostname: options.host,
    port: options.port,
    fetch: (request) => handleOfficeRequest(request, options.store, { accessCode }),
  });

  console.log(`[office] listening on http://${server.hostname}:${server.port} (${accessCode ? "access:on" : "access:off"})`);
}

export async function handleOfficeRequest(
  request: Request,
  store: RuntimeStore,
  options: OfficeRequestOptions = {},
): Promise<Response> {
  const url = new URL(request.url);
  const accessCode = normalizeOfficeSecret(options.accessCode);

  if (url.pathname === "/health") {
    return json({ ok: true, service: "agentrunner-office", access: accessCode ? "enabled" : "disabled" });
  }

  if (url.pathname === "/login") {
    return await handleLoginRequest(request, accessCode);
  }

  if (url.pathname === "/logout") {
    return redirectResponse("/login", clearOfficeSessionHeaders());
  }

  if (!isOfficeRequestAllowed(request, accessCode)) {
    if (url.pathname.startsWith("/api/")) return json({ error: "Unauthorized" }, 401);
    return new Response(renderLoginHtml({ error: "Office access code required." }), {
      status: 401,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  if (url.pathname === "/api/office/snapshot") {
    return json(buildOfficeSnapshot(store));
  }

  if (url.pathname === "/api/office/bridge") {
    return json(buildOfficeBridgePayload(buildOfficeSnapshot(store)));
  }

  if (url.pathname === "/api/office/events") {
    return officeEventsStream(store);
  }

  if (url.pathname === "/" || url.pathname === "/office") {
    return new Response(renderOfficeHtml({ accessLocked: Boolean(accessCode) }), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  return json({ error: "Not found" }, 404);
}

async function handleLoginRequest(request: Request, accessCode: string): Promise<Response> {
  if (!accessCode) return redirectResponse("/office");

  if (request.method !== "POST") {
    return new Response(renderLoginHtml({ error: "" }), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  const form = await request.formData();
  const submittedCode = normalizeOfficeSecret(String(form.get("code") ?? ""));
  if (timingSafeTextEquals(submittedCode, accessCode)) {
    return redirectResponse("/office", officeSessionHeaders(accessCode));
  }

  return new Response(renderLoginHtml({ error: "Invalid Office access code." }), {
    status: 401,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function officeEventsStream(store: RuntimeStore): Response {
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = () => {
        try {
          controller.enqueue(encoder.encode(`event: snapshot\ndata: ${sseJson(buildOfficeSnapshot(store))}\n\n`));
        } catch {
          if (timer) clearInterval(timer);
        }
      };
      send();
      timer = setInterval(send, 3_000);
    },
    cancel() {
      if (timer) clearInterval(timer);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}

function redirectResponse(location: string, headers: Record<string, string> = {}): Response {
  return new Response(null, { status: 302, headers: { ...headers, location } });
}

function sseJson(data: unknown): string {
  return JSON.stringify(data).replaceAll("\n", "\\n");
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
