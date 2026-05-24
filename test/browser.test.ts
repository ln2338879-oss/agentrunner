import { describe, expect, test } from "bun:test";
import { extractUrls } from "../src/browser/adapter";

describe("extractUrls", () => {
  test("extracts unique HTTP URLs", () => {
    expect(extractUrls("Read https://example.com/docs and http://localhost:3000/test.")).toEqual([
      "https://example.com/docs",
      "http://localhost:3000/test",
    ]);
  });

  test("trims trailing punctuation", () => {
    expect(extractUrls("Use https://docs.example.com/api, then compare https://docs.example.com/api.")).toEqual([
      "https://docs.example.com/api",
    ]);
  });
});
