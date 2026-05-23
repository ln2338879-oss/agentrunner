import { readFile } from "node:fs/promises";
import path from "node:path";

const apiKey = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_VISION_MODEL ?? "gemini-2.5-flash";

if (!apiKey) {
  console.error("GEMINI_API_KEY is required.");
  process.exit(1);
}

const stdin = await new Response(Bun.stdin.stream()).text();
const imagePaths = extractImagePaths(stdin);

if (imagePaths.length === 0) {
  console.log("No image paths were provided.");
  process.exit(0);
}

const parts: Array<Record<string, unknown>> = [
  {
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
  parts.push({
    inline_data: {
      mime_type: mimeTypeFor(imagePath),
      data: bytes.toString("base64"),
    },
  });
}

const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    "content-type": "application/json",
  },
  body: JSON.stringify({
    contents: [
      {
        role: "user",
        parts,
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
  const candidates = json.candidates;
  if (!Array.isArray(candidates)) return JSON.stringify(json, null, 2);

  const parts: string[] = [];
  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue;
    const content = candidate.content;
    if (!isRecord(content)) continue;
    const contentParts = content.parts;
    if (!Array.isArray(contentParts)) continue;
    for (const part of contentParts) {
      if (isRecord(part) && typeof part.text === "string") parts.push(part.text);
    }
  }

  return parts.join("\n").trim() || JSON.stringify(json, null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
