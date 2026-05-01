import * as crypto from "node:crypto";

export interface MimeAttachment {
  filename: string;
  contentType: string;
  data: Buffer;
}

export interface DraftPayload {
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  bodyPlain: string;
  bodyHtml: string;
  inReplyTo: string;
  references: string[];
  attachments: MimeAttachment[];
  idempotencyKey: string;
  messageIdDomain: string;
}

export interface RawMessage {
  raw: string;
  messageId: string;
}

interface RawAttachment {
  filename?: unknown;
  name?: unknown;
  content_type?: unknown;
  contentType?: unknown;
  mimeType?: unknown;
  data?: unknown;
}

export function parseAddressList(value: unknown): string[] {
  if (value === undefined || value === null || value === "") return [];
  if (Array.isArray(value)) {
    return value.map((entry) => scalarToString(entry).trim()).filter(Boolean);
  }

  return scalarToString(value)
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function normalizeAttachments(value: unknown): MimeAttachment[] {
  if (value === undefined || value === null || value === "") return [];

  let rawAttachments: unknown;
  if (typeof value === "string") {
    rawAttachments = JSON.parse(value) as unknown;
  } else {
    rawAttachments = value;
  }

  const attachments = Array.isArray(rawAttachments)
    ? rawAttachments
    : [rawAttachments];

  return attachments.map((attachment, index) => {
    if (!isRecord(attachment)) {
      throw new Error(`Attachment ${index + 1} must be an object`);
    }

    const raw = attachment as RawAttachment;
    const filename = scalarToString(raw.filename ?? raw.name ?? "").trim();
    if (!filename) {
      throw new Error(`Attachment ${index + 1} requires filename`);
    }

    if (typeof raw.data !== "string" || !raw.data) {
      throw new Error(`Attachment ${filename} requires base64 data`);
    }

    return {
      filename,
      contentType: scalarToString(
        raw.content_type ??
          raw.contentType ??
          raw.mimeType ??
          "application/octet-stream",
      ),
      data: Buffer.from(raw.data, "base64"),
    };
  });
}

export function buildRawMessage(payload: DraftPayload): RawMessage {
  const messageId = `<n8n-${crypto.randomBytes(16).toString("hex")}@${cleanMessageIdDomain(payload.messageIdDomain)}>`;
  const headers = [
    header("From", payload.from),
    header("To", payload.to.join(", ")),
    ...(payload.cc.length ? [header("Cc", payload.cc.join(", "))] : []),
    ...(payload.bcc.length ? [header("Bcc", payload.bcc.join(", "))] : []),
    header("Subject", payload.subject),
    header("Date", new Date().toUTCString()),
    header("Message-ID", messageId),
    ...(payload.inReplyTo ? [header("In-Reply-To", payload.inReplyTo)] : []),
    ...(payload.references.length
      ? [header("References", payload.references.join(" "))]
      : []),
    header("MIME-Version", "1.0"),
    ...(payload.idempotencyKey
      ? [header("X-N8N-Idempotency-Key", payload.idempotencyKey)]
      : []),
  ];

  const hasHtml = payload.bodyHtml !== "";
  const hasAttachments = payload.attachments.length > 0;

  if (!hasHtml && !hasAttachments) {
    return {
      messageId,
      raw: [
        ...headers,
        "Content-Type: text/plain; charset=utf-8",
        "Content-Transfer-Encoding: base64",
        "",
        encodeText(payload.bodyPlain),
        "",
      ].join("\r\n"),
    };
  }

  if (!hasAttachments) {
    const altBoundary = boundary("alt");
    return {
      messageId,
      raw: [
        ...headers,
        `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
        "",
        ...alternativeParts(altBoundary, payload.bodyPlain, payload.bodyHtml),
        "",
      ].join("\r\n"),
    };
  }

  const mixedBoundary = boundary("mixed");
  const parts = hasHtml
    ? [
        `--${mixedBoundary}`,
        `Content-Type: multipart/alternative; boundary="${boundary("alt", mixedBoundary)}"`,
        "",
        ...alternativeParts(
          boundary("alt", mixedBoundary),
          payload.bodyPlain,
          payload.bodyHtml,
        ),
      ]
    : [
        `--${mixedBoundary}`,
        "Content-Type: text/plain; charset=utf-8",
        "Content-Transfer-Encoding: base64",
        "",
        encodeText(payload.bodyPlain),
        "",
      ];

  for (const attachment of payload.attachments) {
    parts.push(...attachmentPart(mixedBoundary, attachment));
  }

  return {
    messageId,
    raw: [
      ...headers,
      `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
      "",
      ...parts,
      `--${mixedBoundary}--`,
      "",
    ].join("\r\n"),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function scalarToString(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  throw new Error("Expected a string-compatible value");
}

function header(name: string, value: string): string {
  return `${name}: ${cleanHeaderValue(value)}`;
}

function cleanHeaderValue(value: string): string {
  return String(value).replace(/[\r\n]+/g, " ");
}

function cleanMessageIdDomain(value: string): string {
  const cleaned = cleanHeaderValue(value).trim();
  return cleaned || "localhost";
}

function cleanFilename(value: string): string {
  return value.replace(/["\r\n]/g, "_");
}

function boundary(prefix: string, seed?: string): string {
  return `${prefix}-${seed ?? crypto.randomBytes(12).toString("hex")}`;
}

function b64Lines(data: Buffer | string): string {
  const encoded = Buffer.isBuffer(data)
    ? data.toString("base64")
    : Buffer.from(data, "utf8").toString("base64");
  return encoded.replace(/.{1,76}/g, "$&\r\n").trimEnd();
}

function encodeText(text: string): string {
  return b64Lines(text);
}

function alternativeParts(
  boundaryValue: string,
  bodyPlain: string,
  bodyHtml: string,
): string[] {
  return [
    `--${boundaryValue}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    encodeText(bodyPlain),
    `--${boundaryValue}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    encodeText(bodyHtml),
    `--${boundaryValue}--`,
    "",
  ];
}

function attachmentPart(
  mixedBoundary: string,
  attachment: MimeAttachment,
): string[] {
  const filename = cleanFilename(attachment.filename);
  if (!filename) {
    throw new Error("Attachment filename cannot be empty");
  }

  return [
    `--${mixedBoundary}`,
    `Content-Type: ${attachment.contentType}; name="${filename}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${filename}"`,
    "",
    b64Lines(attachment.data),
    "",
  ];
}
