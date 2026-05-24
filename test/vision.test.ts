import { describe, expect, test } from "bun:test";
import { extractImageLocalPaths } from "../src/vision/adapter";

describe("extractImageLocalPaths", () => {
  test("extracts local paths for image attachments only", () => {
    const content = [
      "# Discord Attachments",
      "- filename: ui.png",
      "  kind: image",
      "  local_path: ./data/attachments/1/ui.png",
      "- filename: notes.txt",
      "  kind: file",
      "  local_path: ./data/attachments/1/notes.txt",
    ].join("\n");

    expect(extractImageLocalPaths(content)).toEqual(["./data/attachments/1/ui.png"]);
  });

  test("deduplicates image paths", () => {
    const content = [
      "kind: image",
      "local_path: /tmp/a.png",
      "kind: image",
      "local_path: /tmp/a.png",
    ].join("\n");

    expect(extractImageLocalPaths(content)).toEqual(["/tmp/a.png"]);
  });
});
