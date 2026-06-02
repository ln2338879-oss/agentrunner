import type { RuntimeStore } from "../db/runtime-store";
import { buildOfficeBridgePayload, buildOfficeSnapshot } from "../dashboard/office-model";
import { renderOfficeHtml } from "./html";

export interface OfficeServerOptions {
  store: RuntimeStore;
  host: string;
  port: number;
}

export function startOfficeServer(options: OfficeServerOptions): void {
  const server = Bun.serve({
    hostname: options.host,
    port: options.port,
    fetch: (request) => handleOfficeRequest(request, options.store),
  });

  console.log(`[office] listening on http://${server.hostname}:${server.port}`);
}

export function handleOfficeRequest(request: Request, store: RuntimeStore): Response {
  const url = new URL(request.url);

  if (url.pathname === "/health") {
    return json({ ok: true, service: "agentrunner-office" });
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
    return new Response(renderOfficeHtml(), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  return json({ error: "Not found" }, 404);
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

function sseJson(data: unknown): string {
  return JSON.stringify(data).replaceAll("\n", "\\n");
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
