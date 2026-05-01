import { createMockExecuteFunctions } from "../../../../../test/helpers";
import { Imap } from "../Imap.node";

import type {
  ImapAppendOptions,
  ImapMoveOptions,
  ImapListOptions,
} from "../imap";

jest.mock("../imap", () => ({
  imapAppend: jest.fn(),
  imapMove: jest.fn(),
  imapList: jest.fn(),
}));

import { imapAppend, imapMove, imapList } from "../imap";

const mockedAppend = jest.mocked(imapAppend);
const mockedMove = jest.mocked(imapMove);
const mockedList = jest.mocked(imapList);

const CREDS = {
  imap: {
    host: "mail.example.com",
    port: 993,
    user: "alice",
    password: "secret",
    secure: true,
    allowUnauthorizedCerts: false,
  },
};

beforeEach(() => {
  jest.resetAllMocks();
});

describe("Imap node – Create Draft", () => {
  it("builds a MIME draft and appends it with the Draft flag", async () => {
    mockedAppend.mockResolvedValue();

    const node = new Imap();
    const ctx = createMockExecuteFunctions(
      {
        operation: "createDraft",
        draftsFolder: "Drafts",
        from: "alice@example.com",
        to: "bob@example.com",
        cc: "",
        bcc: "",
        subject: "Draft subject",
        bodyPlain: "Draft body",
        bodyHtml: "",
        attachmentsSource: "none",
        inReplyTo: "",
        references: "",
        idempotencyKey: "draft-key",
        messageIdDomain: "example.com",
      },
      CREDS,
    );

    const [[result]] = await node.execute.call(ctx);

    expect(result.json).toMatchObject({
      success: true,
      folder: "Drafts",
      attachmentCount: 0,
      attachments: [],
    });
    expect(result.json.messageId).toMatch(/^<n8n-[0-9a-f]{32}@example\.com>$/);
    expect(mockedAppend).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "mail.example.com",
        folder: "Drafts",
        flags: ["\\Draft"],
      } satisfies Partial<ImapAppendOptions>),
    );

    const message = mockedAppend.mock.calls[0][0].message.toString("utf8");
    expect(message).toContain("Subject: Draft subject\r\n");
    expect(message).toContain("X-N8N-Idempotency-Key: draft-key\r\n");
    expect(message).toContain(Buffer.from("Draft body").toString("base64"));
  });

  it("attaches selected binary properties", async () => {
    mockedAppend.mockResolvedValue();

    const node = new Imap();
    const ctx = createMockExecuteFunctions(
      {
        operation: "createDraft",
        draftsFolder: "Drafts",
        from: "alice@example.com",
        to: "bob@example.com",
        cc: "",
        bcc: "",
        subject: "With attachment",
        bodyPlain: "See attached",
        bodyHtml: "",
        attachmentsSource: "binary",
        binaryProperties: "report",
        inReplyTo: "",
        references: "",
        idempotencyKey: "",
        messageIdDomain: "example.com",
      },
      CREDS,
      {
        inputItems: [
          {
            json: {},
            binary: {
              report: {
                data: Buffer.from("hello attachment").toString("base64"),
                mimeType: "text/plain",
                fileName: "report.txt",
              },
            },
          },
        ],
      },
    );

    const [[result]] = await node.execute.call(ctx);

    expect(result.json).toMatchObject({
      attachmentCount: 1,
      attachments: ["report.txt"],
    });

    const message = mockedAppend.mock.calls[0][0].message.toString("utf8");
    expect(message).toContain('Content-Type: text/plain; name="report.txt"');
    expect(message).toContain(
      'Content-Disposition: attachment; filename="report.txt"',
    );
    expect(message).toContain(
      Buffer.from("hello attachment").toString("base64"),
    );
  });
});

describe("Imap node – Append", () => {
  it("calls imapAppend with the right parameters", async () => {
    mockedAppend.mockResolvedValue();

    const rawEmail =
      "From: a@b.com\r\nTo: c@d.com\r\nSubject: Test\r\n\r\nHello!";

    const node = new Imap();
    const ctx = createMockExecuteFunctions(
      {
        operation: "append",
        folder: "INBOX.Archive",
        messageSource: "field",
        messageField: "raw",
        flags: "\\Seen \\Flagged",
      },
      CREDS,
      { inputItems: [{ json: { raw: rawEmail } }] },
    );

    const [[result]] = await node.execute.call(ctx);

    expect(result.json).toMatchObject({
      success: true,
      folder: "INBOX.Archive",
      messageSize: Buffer.byteLength(rawEmail),
    });

    expect(mockedAppend).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "mail.example.com",
        folder: "INBOX.Archive",
        flags: ["\\Seen", "\\Flagged"],
        message: Buffer.from(rawEmail),
      } satisfies Partial<ImapAppendOptions>),
    );
  });

  it("reads message from binary data", async () => {
    mockedAppend.mockResolvedValue();

    const rawEmail = "Subject: bin\r\n\r\nbody";
    const b64 = Buffer.from(rawEmail).toString("base64");

    const node = new Imap();
    const ctx = createMockExecuteFunctions(
      {
        operation: "append",
        folder: "INBOX",
        messageSource: "binary",
        binaryProperty: "attachment",
        flags: "",
      },
      CREDS,
      {
        inputItems: [
          {
            json: {},
            binary: {
              attachment: {
                data: b64,
                mimeType: "message/rfc822",
                fileName: "email.eml",
              },
            },
          },
        ],
      },
    );

    const [[result]] = await node.execute.call(ctx);

    expect(result.json).toMatchObject({ success: true, folder: "INBOX" });
    expect(mockedAppend).toHaveBeenCalledWith(
      expect.objectContaining({
        message: Buffer.from(rawEmail),
        flags: [],
      }),
    );
  });
});

describe("Imap node – Move", () => {
  it("calls imapMove with the right parameters", async () => {
    mockedMove.mockResolvedValue();

    const node = new Imap();
    const ctx = createMockExecuteFunctions(
      {
        operation: "move",
        sourceFolder: "INBOX",
        uid: 42,
        destinationFolder: "Archive",
      },
      CREDS,
    );

    const [[result]] = await node.execute.call(ctx);

    expect(result.json).toMatchObject({
      success: true,
      uid: 42,
      sourceFolder: "INBOX",
      destinationFolder: "Archive",
    });

    expect(mockedMove).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "mail.example.com",
        sourceFolder: "INBOX",
        uid: 42,
        destinationFolder: "Archive",
      } satisfies Partial<ImapMoveOptions>),
    );
  });
});

describe("Imap node – List", () => {
  it("returns one item per mailbox", async () => {
    mockedList.mockResolvedValue([
      { name: "INBOX", delimiter: ".", attributes: ["\\HasNoChildren"] },
      {
        name: "Archive",
        delimiter: ".",
        attributes: ["\\HasNoChildren", "\\Subscribed"],
      },
    ]);

    const node = new Imap();
    const ctx = createMockExecuteFunctions(
      {
        operation: "list",
        reference: "",
        pattern: "*",
      },
      CREDS,
    );

    const [results] = await node.execute.call(ctx);

    expect(results).toHaveLength(2);
    expect(results[0].json).toMatchObject({
      name: "INBOX",
      delimiter: ".",
      attributes: ["\\HasNoChildren"],
    });
    expect(results[1].json).toMatchObject({
      name: "Archive",
      delimiter: ".",
      attributes: ["\\HasNoChildren", "\\Subscribed"],
    });

    expect(mockedList).toHaveBeenCalledWith(
      expect.objectContaining({
        reference: "",
        pattern: "*",
      } satisfies Partial<ImapListOptions>),
    );
  });
});
