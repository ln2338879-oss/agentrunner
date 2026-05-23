import type { Attachment, Collection, Snowflake } from "discord.js";

export interface AttachmentContext {
  markdown: string;
  count: number;
}

export function buildAttachmentContext(attachments: Collection<Snowflake, Attachment>): AttachmentContext {
  if (attachments.size === 0) return { markdown: "", count: 0 };

  const lines: string[] = [
    "# Discord Attachments",
    "",
    "The user attached the following files. Use the URLs as reference context when your model or tool supports it.",
    "",
  ];

  for (const attachment of attachments.values()) {
    lines.push(`- filename: ${attachment.name ?? "unknown"}`);
    lines.push(`  url: ${attachment.url}`);
    lines.push(`  content_type: ${attachment.contentType ?? "unknown"}`);
    lines.push(`  size_bytes: ${attachment.size}`);
    if (isImageContentType(attachment.contentType)) {
      lines.push("  kind: image");
    }
  }

  return { markdown: lines.join("\n"), count: attachments.size };
}

function isImageContentType(contentType: string | null): boolean {
  return Boolean(contentType?.startsWith("image/"));
}
