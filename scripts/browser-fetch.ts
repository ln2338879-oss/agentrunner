const stdin = await new Response(Bun.stdin.stream()).text();
const urls = extractUrls(stdin);

if (urls.length === 0) {
  console.log("No URLs were provided.");
  process.exit(0);
}

const sections: string[] = [];

for (const url of urls) {
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": "AgentRunner browser-fetch/0.1",
      },
    });
    const text = await response.text();
    sections.push([
      `## ${url}`,
      "",
      `status: ${response.status}`,
      `content_type: ${response.headers.get("content-type") ?? "unknown"}`,
      "",
      "```text",
      extractReadableText(text).slice(0, 6000),
      "```",
    ].join("\n"));
  } catch (error) {
    sections.push([
      `## ${url}`,
      "",
      "fetch_failed: true",
      `error: ${error instanceof Error ? error.message : String(error)}`,
    ].join("\n"));
  }
}

console.log(sections.join("\n\n"));

function extractUrls(content: string): string[] {
  const matches = content.match(/https?:\/\/[^\s)\]>"']+/g) ?? [];
  return [...new Set(matches.map((url) => url.replace(/[.,;:!?]+$/, "")))];
}

function extractReadableText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}
