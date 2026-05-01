import {
  buildRawMessage,
  normalizeAttachments,
  parseAddressList,
} from "../Mime";

describe("IMAP MIME builder", () => {
  it("builds a plain text draft message", () => {
    const { raw, messageId } = buildRawMessage({
      from: "alice@example.com",
      to: ["bob@example.com"],
      cc: [],
      bcc: [],
      subject: "Hello",
      bodyPlain: "Draft body",
      bodyHtml: "",
      inReplyTo: "",
      references: [],
      attachments: [],
      idempotencyKey: "draft-1",
      messageIdDomain: "example.com",
    });

    expect(messageId).toMatch(/^<n8n-[0-9a-f]{32}@example\.com>$/);
    expect(raw).toContain("Subject: Hello\r\n");
    expect(raw).toContain("X-N8N-Idempotency-Key: draft-1\r\n");
    expect(raw).toContain("Content-Type: text/plain; charset=utf-8\r\n");
    expect(raw).toContain(Buffer.from("Draft body").toString("base64"));
  });

  it("builds multipart messages with attachments", () => {
    const { raw } = buildRawMessage({
      from: "alice@example.com",
      to: ["bob@example.com"],
      cc: [],
      bcc: [],
      subject: "Report",
      bodyPlain: "See attached",
      bodyHtml: "<p>See attached</p>",
      inReplyTo: "",
      references: [],
      attachments: [
        {
          filename: "report.txt",
          contentType: "text/plain",
          data: Buffer.from("report body"),
        },
      ],
      idempotencyKey: "",
      messageIdDomain: "example.com",
    });

    expect(raw).toContain("Content-Type: multipart/mixed;");
    expect(raw).toContain("Content-Type: multipart/alternative;");
    expect(raw).toContain('Content-Type: text/plain; name="report.txt"');
    expect(raw).toContain(
      'Content-Disposition: attachment; filename="report.txt"',
    );
    expect(raw).toContain(Buffer.from("report body").toString("base64"));
  });

  it("normalizes JSON attachments", () => {
    expect(
      normalizeAttachments(
        JSON.stringify([
          {
            filename: "hello.txt",
            content_type: "text/plain",
            data: Buffer.from("hello").toString("base64"),
          },
        ]),
      ),
    ).toEqual([
      {
        filename: "hello.txt",
        contentType: "text/plain",
        data: Buffer.from("hello"),
      },
    ]);
  });

  it("parses comma and whitespace separated address lists", () => {
    expect(
      parseAddressList("alice@example.com, bob@example.com carol@example.com"),
    ).toEqual(["alice@example.com", "bob@example.com", "carol@example.com"]);
  });
});
