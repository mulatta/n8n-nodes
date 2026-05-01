import { NodeConnectionTypes, NodeOperationError } from "n8n-workflow";

import {
  buildRawMessage,
  normalizeAttachments,
  parseAddressList,
} from "./Mime";

import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  IDataObject,
  IBinaryData,
} from "n8n-workflow";

import type { ImapConnectOptions } from "./imap";
import { imapAppend, imapMove, imapList } from "./imap";
import type { MimeAttachment } from "./Mime";

/** Map upstream n8n `imap` credential fields to ImapConnectOptions. */
function credentialsToConnectOptions(raw: IDataObject): ImapConnectOptions {
  return {
    host: raw.host as string,
    port: raw.port as number,
    user: raw.user as string,
    password: raw.password as string,
    tls: raw.secure as boolean,
    rejectUnauthorized: !(raw.allowUnauthorizedCerts as boolean),
  };
}

export class Imap implements INodeType {
  description: INodeTypeDescription = {
    displayName: "IMAP",
    name: "imap",
    icon: "file:imap.svg",
    group: ["output"],
    version: 1,
    subtitle: '={{$parameter["operation"]}}',
    description: "Interact with an IMAP mailbox",
    defaults: {
      name: "IMAP",
    },
    usableAsTool: true,
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    credentials: [
      {
        name: "imap",
        required: true,
      },
    ],
    properties: [
      {
        displayName: "Operation",
        name: "operation",
        type: "options",
        noDataExpression: true,
        options: [
          {
            name: "Append",
            value: "append",
            description: "Store a raw email message in a mailbox folder",
          },
          {
            name: "Create Draft",
            value: "createDraft",
            description:
              "Build a MIME email and store it in the drafts mailbox",
          },
          {
            name: "List",
            value: "list",
            description: "List mailbox folders",
          },
          {
            name: "Move",
            value: "move",
            description: "Move a message to another folder by UID",
          },
        ],
        default: "createDraft",
      },
      // --- Create Draft fields ---
      {
        displayName: "Drafts Folder",
        name: "draftsFolder",
        type: "string",
        default: "Drafts",
        required: true,
        displayOptions: {
          show: {
            operation: ["createDraft"],
          },
        },
        description: "Mailbox folder where the draft will be appended",
      },
      {
        displayName: "From",
        name: "from",
        type: "string",
        default: "={{ $json.from || '' }}",
        required: true,
        displayOptions: {
          show: {
            operation: ["createDraft"],
          },
        },
      },
      {
        displayName: "To",
        name: "to",
        type: "string",
        default:
          "={{ Array.isArray($json.to) ? $json.to.join(', ') : ($json.to || '') }}",
        required: true,
        displayOptions: {
          show: {
            operation: ["createDraft"],
          },
        },
      },
      {
        displayName: "Cc",
        name: "cc",
        type: "string",
        default:
          "={{ Array.isArray($json.cc) ? $json.cc.join(', ') : ($json.cc || '') }}",
        displayOptions: {
          show: {
            operation: ["createDraft"],
          },
        },
      },
      {
        displayName: "Bcc",
        name: "bcc",
        type: "string",
        default:
          "={{ Array.isArray($json.bcc) ? $json.bcc.join(', ') : ($json.bcc || '') }}",
        displayOptions: {
          show: {
            operation: ["createDraft"],
          },
        },
      },
      {
        displayName: "Subject",
        name: "subject",
        type: "string",
        default: "={{ $json.subject || '' }}",
        required: true,
        displayOptions: {
          show: {
            operation: ["createDraft"],
          },
        },
      },
      {
        displayName: "Plain Body",
        name: "bodyPlain",
        type: "string",
        typeOptions: {
          rows: 5,
        },
        default: "={{ $json.body_plain || $json.bodyPlain || '' }}",
        displayOptions: {
          show: {
            operation: ["createDraft"],
          },
        },
      },
      {
        displayName: "HTML Body",
        name: "bodyHtml",
        type: "string",
        typeOptions: {
          rows: 5,
        },
        default: "={{ $json.body_html || $json.bodyHtml || '' }}",
        displayOptions: {
          show: {
            operation: ["createDraft"],
          },
        },
      },
      {
        displayName: "Attachments Source",
        name: "attachmentsSource",
        type: "options",
        options: [
          {
            name: "None",
            value: "none",
          },
          {
            name: "JSON",
            value: "json",
            description: "Read base64 attachments from a JSON parameter",
          },
          {
            name: "Binary Properties",
            value: "binary",
            description: "Read attachments from named binary properties",
          },
          {
            name: "All Binary Data",
            value: "allBinary",
            description: "Attach all binary properties from the input item",
          },
        ],
        default: "none",
        displayOptions: {
          show: {
            operation: ["createDraft"],
          },
        },
      },
      {
        displayName: "Attachments JSON",
        name: "attachmentsJson",
        type: "json",
        default: "={{ JSON.stringify($json.attachments || []) }}",
        displayOptions: {
          show: {
            operation: ["createDraft"],
            attachmentsSource: ["json"],
          },
        },
        description:
          "Array of { filename, contentType/content_type, data } objects. Data must be base64.",
      },
      {
        displayName: "Binary Properties",
        name: "binaryProperties",
        type: "string",
        default: "data",
        displayOptions: {
          show: {
            operation: ["createDraft"],
            attachmentsSource: ["binary"],
          },
        },
        description: "Comma-separated binary property names to attach",
      },
      {
        displayName: "In-Reply-To",
        name: "inReplyTo",
        type: "string",
        default: "={{ $json.in_reply_to || $json.inReplyTo || '' }}",
        displayOptions: {
          show: {
            operation: ["createDraft"],
          },
        },
      },
      {
        displayName: "References",
        name: "references",
        type: "string",
        default:
          "={{ Array.isArray($json.references) ? $json.references.join(' ') : ($json.references || '') }}",
        displayOptions: {
          show: {
            operation: ["createDraft"],
          },
        },
      },
      {
        displayName: "Idempotency Key",
        name: "idempotencyKey",
        type: "string",
        default: "={{ $json.idempotency_key || $json.idempotencyKey || '' }}",
        displayOptions: {
          show: {
            operation: ["createDraft"],
          },
        },
        description: "Stored as X-N8N-Idempotency-Key in the draft message",
      },
      {
        displayName: "Message-ID Domain",
        name: "messageIdDomain",
        type: "string",
        default: "localhost",
        required: true,
        displayOptions: {
          show: {
            operation: ["createDraft"],
          },
        },
      },
      // --- Append fields ---
      {
        displayName: "Folder",
        name: "folder",
        type: "string",
        default: "INBOX",
        required: true,
        displayOptions: {
          show: {
            operation: ["append"],
          },
        },
        description: "Target IMAP mailbox folder (e.g. INBOX, Archive)",
      },
      {
        displayName: "Message Source",
        name: "messageSource",
        type: "options",
        options: [
          {
            name: "JSON Field",
            value: "field",
            description: "Read the raw RFC 2822 message from a JSON field",
          },
          {
            name: "Binary Data",
            value: "binary",
            description: "Read the message from a binary attachment",
          },
        ],
        default: "field",
        displayOptions: {
          show: {
            operation: ["append"],
          },
        },
        description: "Where the raw RFC 2822 email message comes from",
      },
      {
        displayName: "Message Field",
        name: "messageField",
        type: "string",
        default: "raw",
        required: true,
        displayOptions: {
          show: {
            operation: ["append"],
            messageSource: ["field"],
          },
        },
        description: "Name of the JSON field containing the raw RFC 2822 email",
      },
      {
        displayName: "Binary Property",
        name: "binaryProperty",
        type: "string",
        default: "data",
        required: true,
        displayOptions: {
          show: {
            operation: ["append"],
            messageSource: ["binary"],
          },
        },
        description: "Name of the binary property containing the email",
      },
      {
        displayName: "Flags",
        name: "flags",
        type: "string",
        default: "\\Seen",
        displayOptions: {
          show: {
            operation: ["append"],
          },
        },
        description:
          "Space-separated IMAP flags to set on the message (e.g. \\Seen \\Flagged)",
      },
      // --- Move fields ---
      {
        displayName: "Source Folder",
        name: "sourceFolder",
        type: "string",
        default: "INBOX",
        required: true,
        displayOptions: {
          show: {
            operation: ["move"],
          },
        },
        description: "Folder the message is currently in",
      },
      {
        displayName: "UID",
        name: "uid",
        type: "number",
        default: 0,
        required: true,
        displayOptions: {
          show: {
            operation: ["move"],
          },
        },
        description: "UID of the message to move",
      },
      {
        displayName: "Destination Folder",
        name: "destinationFolder",
        type: "string",
        default: "",
        required: true,
        displayOptions: {
          show: {
            operation: ["move"],
          },
        },
        description: "Folder to move the message to",
      },
      // --- List fields ---
      {
        displayName: "Reference",
        name: "reference",
        type: "string",
        default: "",
        displayOptions: {
          show: {
            operation: ["list"],
          },
        },
        description: "IMAP LIST reference name (usually empty for the root)",
      },
      {
        displayName: "Pattern",
        name: "pattern",
        type: "string",
        default: "*",
        displayOptions: {
          show: {
            operation: ["list"],
          },
        },
        description: "Mailbox name pattern (* = all, % = top-level only)",
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];
    const credentials = await this.getCredentials("imap");
    const creds = credentialsToConnectOptions(credentials);

    if (!creds.host) {
      throw new NodeOperationError(
        this.getNode(),
        "IMAP host must be configured in credentials",
      );
    }

    const operation = this.getNodeParameter("operation", 0);

    for (let i = 0; i < items.length; i++) {
      try {
        let results: IDataObject[];

        if (operation === "append") {
          results = [await executeAppend(this, i, items, creds)];
        } else if (operation === "createDraft") {
          results = [await executeCreateDraft(this, i, items, creds)];
        } else if (operation === "move") {
          results = [await executeMove(this, i, creds)];
        } else if (operation === "list") {
          results = await executeList(this, i, creds);
        } else {
          throw new NodeOperationError(
            this.getNode(),
            `Unknown operation: ${operation}`,
            { itemIndex: i },
          );
        }

        for (const result of results) {
          returnData.push(
            ...this.helpers.constructExecutionMetaData(
              this.helpers.returnJsonArray(result),
              { itemData: { item: i } },
            ),
          );
        }
      } catch (error) {
        if (this.continueOnFail()) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          returnData.push(
            ...this.helpers.constructExecutionMetaData(
              this.helpers.returnJsonArray({ error: errorMessage }),
              { itemData: { item: i } },
            ),
          );
          continue;
        }
        throw error;
      }
    }

    return [returnData];
  }
}

async function executeCreateDraft(
  ctx: IExecuteFunctions,
  itemIndex: number,
  items: INodeExecutionData[],
  creds: ImapConnectOptions,
): Promise<IDataObject> {
  const folder = ctx.getNodeParameter("draftsFolder", itemIndex) as string;
  const from = getStringParameter(ctx, "from", itemIndex).trim();
  const to = parseAddressList(ctx.getNodeParameter("to", itemIndex));
  const cc = parseAddressList(ctx.getNodeParameter("cc", itemIndex, ""));
  const bcc = parseAddressList(ctx.getNodeParameter("bcc", itemIndex, ""));
  const subject = getStringParameter(ctx, "subject", itemIndex).trim();
  const bodyPlain = getStringParameter(ctx, "bodyPlain", itemIndex, "");
  const bodyHtml = getStringParameter(ctx, "bodyHtml", itemIndex, "");
  const inReplyTo = getStringParameter(ctx, "inReplyTo", itemIndex, "").trim();
  const references = parseAddressList(
    ctx.getNodeParameter("references", itemIndex, ""),
  );
  const idempotencyKey = getStringParameter(
    ctx,
    "idempotencyKey",
    itemIndex,
    "",
  ).trim();
  const messageIdDomain = getStringParameter(
    ctx,
    "messageIdDomain",
    itemIndex,
    "localhost",
  ).trim();

  const errors: string[] = [];
  if (!from) errors.push("from is required");
  if (to.length === 0) errors.push("to is required");
  if (!subject) errors.push("subject is required");
  if (!bodyPlain && !bodyHtml) errors.push("bodyPlain or bodyHtml is required");
  if (errors.length) {
    throw new NodeOperationError(ctx.getNode(), errors.join("; "), {
      itemIndex,
    });
  }

  const attachments = getDraftAttachments(ctx, itemIndex, items);
  const { raw, messageId } = buildRawMessage({
    from,
    to,
    cc,
    bcc,
    subject,
    bodyPlain,
    bodyHtml,
    inReplyTo,
    references,
    attachments,
    idempotencyKey,
    messageIdDomain,
  });
  const message = Buffer.from(raw, "utf-8");

  await imapAppend({
    ...creds,
    folder,
    flags: ["\\Draft"],
    message,
  });

  return {
    success: true,
    folder,
    messageId,
    messageSize: message.length,
    attachmentCount: attachments.length,
    attachments: attachments.map((attachment) => attachment.filename),
  };
}

function getDraftAttachments(
  ctx: IExecuteFunctions,
  itemIndex: number,
  items: INodeExecutionData[],
): MimeAttachment[] {
  const source = ctx.getNodeParameter(
    "attachmentsSource",
    itemIndex,
    "none",
  ) as string;

  if (source === "none") return [];
  if (source === "json") {
    return normalizeAttachments(
      ctx.getNodeParameter("attachmentsJson", itemIndex, "[]"),
    );
  }

  const binary = items[itemIndex].binary ?? {};
  const properties =
    source === "allBinary"
      ? Object.keys(binary)
      : parseAddressList(ctx.getNodeParameter("binaryProperties", itemIndex));

  return properties.map((property) => {
    const binaryData = binary[property];
    if (!binaryData) {
      throw new NodeOperationError(
        ctx.getNode(),
        `No binary data found in property "${property}"`,
        { itemIndex },
      );
    }
    return binaryAttachment(property, binaryData);
  });
}

function binaryAttachment(
  property: string,
  binaryData: IBinaryData,
): MimeAttachment {
  return {
    filename: binaryData.fileName || property,
    contentType: binaryData.mimeType || "application/octet-stream",
    data: Buffer.from(binaryData.data, "base64"),
  };
}

function getStringParameter(
  ctx: IExecuteFunctions,
  name: string,
  itemIndex: number,
  defaultValue?: string,
): string {
  const value = ctx.getNodeParameter(name, itemIndex, defaultValue);
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  throw new NodeOperationError(ctx.getNode(), `${name} must be a string`, {
    itemIndex,
  });
}

async function executeAppend(
  ctx: IExecuteFunctions,
  itemIndex: number,
  items: INodeExecutionData[],
  creds: ImapConnectOptions,
): Promise<IDataObject> {
  const folder = ctx.getNodeParameter("folder", itemIndex) as string;
  const messageSource = ctx.getNodeParameter("messageSource", itemIndex);
  const flagsRaw = getStringParameter(ctx, "flags", itemIndex, "");

  const flags = flagsRaw.split(/\s+/).filter((f) => f.length > 0);

  let message: Buffer;

  if (messageSource === "binary") {
    const binaryProperty = ctx.getNodeParameter("binaryProperty", itemIndex);
    const binaryData = items[itemIndex].binary?.[binaryProperty];
    if (!binaryData) {
      throw new NodeOperationError(
        ctx.getNode(),
        `No binary data found in property "${binaryProperty}"`,
        { itemIndex },
      );
    }
    message = Buffer.from(binaryData.data, "base64");
  } else {
    const messageField = ctx.getNodeParameter(
      "messageField",
      itemIndex,
    ) as string;
    const raw = items[itemIndex].json[messageField];
    if (typeof raw !== "string" || !raw) {
      throw new NodeOperationError(
        ctx.getNode(),
        `JSON field "${messageField}" is empty or not a string`,
        { itemIndex },
      );
    }
    message = Buffer.from(raw, "utf-8");
  }

  await imapAppend({
    ...creds,
    folder,
    flags,
    message,
  });

  return { success: true, folder, messageSize: message.length };
}

async function executeMove(
  ctx: IExecuteFunctions,
  itemIndex: number,
  creds: ImapConnectOptions,
): Promise<IDataObject> {
  const sourceFolder = ctx.getNodeParameter(
    "sourceFolder",
    itemIndex,
  ) as string;
  const uid = ctx.getNodeParameter("uid", itemIndex) as number;
  const destinationFolder = ctx.getNodeParameter(
    "destinationFolder",
    itemIndex,
  ) as string;

  await imapMove({
    ...creds,
    sourceFolder,
    uid,
    destinationFolder,
  });

  return { success: true, uid, sourceFolder, destinationFolder };
}

async function executeList(
  ctx: IExecuteFunctions,
  itemIndex: number,
  creds: ImapConnectOptions,
): Promise<IDataObject[]> {
  const reference = ctx.getNodeParameter("reference", itemIndex, "") as string;
  const pattern = getStringParameter(ctx, "pattern", itemIndex, "*");

  const mailboxes = await imapList({
    ...creds,
    reference,
    pattern,
  });

  return mailboxes.map((m) => ({
    name: m.name,
    delimiter: m.delimiter,
    attributes: m.attributes,
  }));
}
