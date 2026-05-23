import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Attachment, Collection, Snowflake } from "discord.js";

export interface AttachmentContext {
  markdown: string;
  count: number;
}

export interface PersistedAttachment {
  filename: string;
  url: string;
  contentType: string;
  sizeBytes: number;
  localPath?: string;
  kind: "image" | "file";
  skippedReason?: string;
}

export function buildAttachmentContext(attachments: Collection<Snowflake, Attachment>): AttachmentContext {
  if (attachments.size === 0) return { markdown: "", count: 0 };

  return formatAttachmentContext(
    Array.from(attachments.values()).map((attachment) => ({
      filename: attachment.name ?? "unknown",
      url: attachment.url,
      contentType: attachment.contentType ?? "unknown",
      sizeBytes: attachment.size,
      kind: isImageContentType(attachment.contentType) ? "image" : "file",
    })),
  );
}

export async function persistAttachmentContext(input: {
  attachments: Collection<Snowflake, Attachment>;
  attachmentsDir: string;
  messageId: string;
  maxAttachmentBytes: number;
}): Promise<AttachmentContext> {
  if (input.attachments.size === 0) return { markdown: "", count: 0 };

  const targetDir = path.join(input.attachmentsDir, input.messageId);
  await mkdir(targetDir, { recursive: true });

  const persisted: PersistedAttachment[] = [];

  for (const attachment of input.attachments.values()) {
    const filename = attachment.name ?? "attachment";
    const item: PersistedAttachment = {
      filename,
      url: attachment.url,
      contentType: attachment.contentType ?? "unknown",
      sizeBytes: attachment.size,
      kind: isImageContentType(attachment.contentType) ? "image" : "file",
    };

    if (attachment.size > input.maxAttachmentBytes) {
      item.skippedReason = `file exceeds MAX_ATTACHMENT_BYTES=${input.maxAttachmentBytes}`;
      persisted.push(item);
      continue;
    }

    try {
      const response = await fetch(attachment.url);
      if (!response.ok) {
        item.skippedReason = `download failed with HTTP ${response.status}`;
        persisted.push(item);
        continue;
      }

      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.byteLength > input.maxAttachmentBytes) {
        item.skippedReason = `downloaded file exceeds MAX_ATTACHMENT_BYTES=${input.maxAttachmentBytes}`;
        persisted.push(item);
        continue;
      }

      const localPath = path.join(targetDir, safeFileName(filename));
      await writeFile(localPath, bytes);
      item.localPath = localPath;
    } catch (error) {
      item.skippedReason = error instanceof Error ? error.message : String(error);
    }

    persisted.push(item);
  }

  return formatAttachmentContext(persisted);
}

function formatAttachmentContext(attachments: PersistedAttachment[]): AttachmentContext {
  if (attachments.length === 0) return { markdown: "", count: 0 };

  const lines: string[] = [
    "# Discord Attachments",
    "",
    "The user attached the following files. Use local_path for vision-capable tools when available, otherwise use url as reference context.",
    "",
  ];

  for (const attachment of attachments) {
    lines.push(`- filename: ${attachment.filename}`);
    lines.push(`  url: ${attachment.url}`);
    lines.push(`  content_type: ${attachment.contentType}`);
    lines.push(`  size_bytes: ${attachment.sizeBytes}`);
    lines.push(`  kind: ${attachment.kind}`);
    if (attachment.localPath) {
      lines.push(`  local_path: ${attachment.localPath}`);
    }
    if (attachment.skippedReason) {
      lines.push(`  skipped_reason: ${attachment.skippedReason}`);
    }
  }

  return { markdown: lines.join("\n"), count: attachments.length };
}

function isImageContentType(contentType: string | null): boolean {
  return Boolean(contentType?.startsWith("image/"));
}

function safeFileName(filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "");
  return safe || "attachment";
}
