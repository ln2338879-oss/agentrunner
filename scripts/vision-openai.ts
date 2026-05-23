import { readFile } from "node:fs/promises";
import path from "node:path";

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_VISION_MODEL ?? "gpt-4.1-mini";

if (!apiKey) {
  console.error("OPENAI_API_KEY is required.");
  process.exit(1);
}

const stdin = await new Response(Bun.stdin.stream()).text();
const imagePaths = extractImagePaths(stdin);

if (imagePaths.length === 0) {
  console.log("No image paths were provided.");
  process.exit(0);
}

const content: Array<Record<string, unknown>> = [
  {
    type: "input_text",
    text: [
      "Analyze these game-development images.",
      "Focus on UI issues, visual defects, art direction, layout, readable details, and actionable implementation notes.",
      "Return concise bullet points in Korean.",
      "",
      stdin,
    ].join("\n"),
  },
];

for (const imagePath of imagePaths) {
  const bytes = await readFile(imagePath);
  content.push({
    type: "input_image",
    image_url: `data:${mimeTypeFor(imagePath)};base64,${bytes.toString("base64")}`,
  });
}

const response = await fetch("https://api.openai.com/v1/responses", {
  method: "POST",
  headers: {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    model,
    input: [
      {
        role: "user",
        content,
      },
    ],
  }),
});

const json = await response.json() as Record<string, unknown>;

if (!response.ok) {
  console.error(JSON.stringify(json, null, 2));
  process.exit(1);
}

console.log(extractOutputText(json));

function extractImagePaths(text: string): string[] {
  return [...new Set(text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-") || line.startsWith("local_path:"))
    .map((line) => line.replace(/^[-\s]*/, "").replace(/^local_path:\s*/, "").trim())
    .filter(Boolean))];
}

function mimeTypeFor(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  return "image/png";
}

function extractOutputText(json: Record<string, unknown>): string {
  if (typeof json.output_text === "string") return json.output_text;

  const output = json.output;
  if (!Array.isArray(output)) return JSON.stringify(json, null, 2);

  const parts: string[] = [];
  for (const item of output) {
    if (!isRecord(item)) continue;
    const content = item.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!isRecord(block)) continue;
      if (typeof block.text === "string") parts.push(block.text);
    }
  }

  return parts.join("\n").trim() || JSON.stringify(json, null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
