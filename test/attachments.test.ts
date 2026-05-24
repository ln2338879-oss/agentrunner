import { describe, expect, test } from "bun:test";
import { Collection } from "discord.js";
import { buildAttachmentContext } from "../src/discord/attachments";

describe("buildAttachmentContext", () => {
  test("returns empty context when there are no attachments", () => {
    const result = buildAttachmentContext(new Collection());
    expect(result.count).toBe(0);
    expect(result.markdown).toBe("");
  });

  test("marks image attachments", () => {
    const attachments = new Collection<string, any>();
    attachments.set("1", {
      name: "mock.png",
      url: "https://cdn.example.com/mock.png",
      contentType: "image/png",
      size: 123,
    });

    const result = buildAttachmentContext(attachments);
    expect(result.count).toBe(1);
    expect(result.markdown).toContain("filename: mock.png");
    expect(result.markdown).toContain("content_type: image/png");
    expect(result.markdown).toContain("kind: image");
  });
});
