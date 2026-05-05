import { NodeConnectionTypes, NodeOperationError } from "n8n-workflow";

import {
  buildRawMessage,
  normalizeAttachments,
  parseAddressList,
} from "./Mime";
import {
  JmapClient,
  keywordsFromString,
  keywordsToString,
  parseJsonArray,
  parseJsonObject,
} from "./Jmap";

import type {
  IBinaryData,
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from "n8n-workflow";
import type { MimeAttachment } from "./Mime";
import type { JmapCredentials, MailboxReferenceType } from "./Jmap";

function credentialsToJmapCredentials(raw: IDataObject): JmapCredentials {
  return {
    sessionUrl: raw.sessionUrl as string,
    username: raw.username as string,
    password: raw.password as string,
    publicOrigin: raw.publicOrigin as string | undefined,
  };
}

export class Jmap implements INodeType {
  description: INodeTypeDescription = {
    displayName: "JMAP",
    name: "jmap",
    icon: "file:jmap.svg",
    group: ["output"],
    version: 1,
    subtitle: '={{$parameter["operation"]}}',
    description: "Interact with JMAP mailboxes and email objects",
    defaults: {
      name: "JMAP",
    },
    usableAsTool: true,
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    credentials: [
      {
        name: "jmapApi",
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
            name: "Create Draft",
            value: "createDraft",
            description: "Build a MIME email and import it into drafts",
          },
          {
            name: "Get Email",
            value: "getEmail",
            description: "Get one email by JMAP Email id",
          },
          {
            name: "Import Email",
            value: "importEmail",
            description: "Upload a raw RFC 5322 message and import it",
          },
          {
            name: "List Mailboxes",
            value: "listMailboxes",
            description: "List JMAP mailboxes with IMAP-style pattern support",
          },
          {
            name: "Move Email",
            value: "moveEmail",
            description: "Move an email by changing its mailboxIds",
          },
          {
            name: "Query Emails",
            value: "queryEmails",
            description: "Query email ids for a JMAP filter",
          },
          {
            name: "Set Keywords",
            value: "setKeywords",
            description: "Replace, add, or remove JMAP keywords",
          },
        ],
        default: "createDraft",
      },
      {
        displayName: "Mailbox Reference Type",
        name: "mailboxReferenceType",
        type: "options",
        options: mailboxReferenceOptions(),
        default: "role",
        displayOptions: {
          show: {
            operation: ["createDraft", "importEmail"],
          },
        },
      },
      {
        displayName: "Mailbox",
        name: "mailboxReference",
        type: "string",
        default: "drafts",
        required: true,
        displayOptions: {
          show: {
            operation: ["createDraft", "importEmail"],
          },
        },
        description: "Mailbox id, role, or path depending on reference type",
      },
      {
        displayName: "Path Delimiter",
        name: "pathDelimiter",
        type: "string",
        default: "/",
        displayOptions: {
          show: {
            operation: [
              "createDraft",
              "importEmail",
              "listMailboxes",
              "moveEmail",
            ],
          },
        },
        description: "Delimiter used when assembling JMAP mailbox paths",
      },
      // --- Create Draft fields ---
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
        typeOptions: { rows: 5 },
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
        typeOptions: { rows: 5 },
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
          { name: "None", value: "none" },
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
      // --- Import Email fields ---
      {
        displayName: "Message Source",
        name: "messageSource",
        type: "options",
        options: [
          {
            name: "JSON Field",
            value: "field",
            description: "Read raw RFC 5322 message from a JSON field",
          },
          {
            name: "Binary Data",
            value: "binary",
            description: "Read raw RFC 5322 message from binary data",
          },
        ],
        default: "field",
        displayOptions: {
          show: {
            operation: ["importEmail"],
          },
        },
      },
      {
        displayName: "Message Field",
        name: "messageField",
        type: "string",
        default: "raw",
        required: true,
        displayOptions: {
          show: {
            operation: ["importEmail"],
            messageSource: ["field"],
          },
        },
      },
      {
        displayName: "Binary Property",
        name: "binaryProperty",
        type: "string",
        default: "data",
        required: true,
        displayOptions: {
          show: {
            operation: ["importEmail"],
            messageSource: ["binary"],
          },
        },
      },
      {
        displayName: "Keywords / IMAP Flags",
        name: "keywords",
        type: "string",
        default: "$seen",
        displayOptions: {
          show: {
            operation: ["importEmail", "setKeywords"],
          },
        },
        description:
          "Space-separated JMAP keywords or IMAP flags. Examples: $seen $flagged or \\Seen \\Flagged.",
      },
      {
        displayName: "Received At",
        name: "receivedAt",
        type: "string",
        default: "",
        displayOptions: {
          show: {
            operation: ["importEmail"],
          },
        },
        description: "Optional RFC 3339 timestamp for Email/import receivedAt",
      },
      // --- Move Email fields ---
      {
        displayName: "Email ID",
        name: "emailId",
        type: "string",
        default: "={{ $json.email_id || $json.emailId || $json.id || '' }}",
        required: true,
        displayOptions: {
          show: {
            operation: ["moveEmail", "getEmail", "setKeywords"],
          },
        },
        description: "JMAP Email id",
      },
      {
        displayName: "Destination Reference Type",
        name: "destinationReferenceType",
        type: "options",
        options: mailboxReferenceOptions(),
        default: "id",
        displayOptions: {
          show: {
            operation: ["moveEmail"],
          },
        },
      },
      {
        displayName: "Destination Mailbox",
        name: "destinationMailboxReference",
        type: "string",
        default: "",
        required: true,
        displayOptions: {
          show: {
            operation: ["moveEmail"],
          },
        },
        description: "Destination mailbox id, role, or path",
      },
      {
        displayName: "Remove From",
        name: "removeMode",
        type: "options",
        options: [
          {
            name: "Current Mailboxes",
            value: "current",
            description: "Remove all existing mailboxIds and add destination",
          },
          {
            name: "None (Copy-Like)",
            value: "none",
            description: "Keep current mailboxIds and add destination",
          },
          {
            name: "Specified Source Mailbox",
            value: "source",
            description: "Remove only the configured source mailboxId",
          },
        ],
        default: "current",
        displayOptions: {
          show: {
            operation: ["moveEmail"],
          },
        },
      },
      {
        displayName: "Source Mailbox ID",
        name: "sourceMailboxId",
        type: "string",
        default: "={{ $json.mailbox_id || $json.mailboxId || '' }}",
        displayOptions: {
          show: {
            operation: ["moveEmail"],
            removeMode: ["source"],
          },
        },
      },
      // --- List fields ---
      {
        displayName: "Pattern",
        name: "pattern",
        type: "string",
        default: "*",
        displayOptions: {
          show: {
            operation: ["listMailboxes"],
          },
        },
        description:
          "IMAP-style pattern. * matches any depth, % matches one level.",
      },
      // --- Query/Get/Keyword fields ---
      {
        displayName: "Filter JSON",
        name: "filterJson",
        type: "json",
        default: "{}",
        displayOptions: {
          show: {
            operation: ["queryEmails"],
          },
        },
        description: "JMAP Email/query filter object",
      },
      {
        displayName: "Sort JSON",
        name: "sortJson",
        type: "json",
        default: "[]",
        displayOptions: {
          show: {
            operation: ["queryEmails"],
          },
        },
        description: "JMAP Email/query sort array",
      },
      {
        displayName: "Position",
        name: "position",
        type: "number",
        default: 0,
        displayOptions: {
          show: {
            operation: ["queryEmails"],
          },
        },
      },
      {
        displayName: "Limit",
        name: "limit",
        type: "number",
        default: 10,
        displayOptions: {
          show: {
            operation: ["queryEmails"],
          },
        },
      },
      {
        displayName: "Split Results",
        name: "splitResults",
        type: "boolean",
        default: true,
        displayOptions: {
          show: {
            operation: ["queryEmails"],
          },
        },
        description: "Return one output item per email id",
      },
      {
        displayName: "Properties",
        name: "properties",
        type: "string",
        default:
          "id,blobId,threadId,mailboxIds,keywords,from,to,cc,bcc,subject,receivedAt,preview",
        displayOptions: {
          show: {
            operation: ["getEmail"],
          },
        },
        description: "Comma-separated Email/get properties",
      },
      {
        displayName: "Keyword Mode",
        name: "keywordMode",
        type: "options",
        options: [
          { name: "Replace", value: "replace" },
          { name: "Add", value: "add" },
          { name: "Remove", value: "remove" },
        ],
        default: "replace",
        displayOptions: {
          show: {
            operation: ["setKeywords"],
          },
        },
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];
    const credentials = await this.getCredentials("jmapApi");
    const creds = credentialsToJmapCredentials(credentials);

    if (!creds.sessionUrl) {
      throw new NodeOperationError(
        this.getNode(),
        "JMAP session URL must be configured in credentials",
      );
    }

    const operation = this.getNodeParameter("operation", 0);
    const client = new JmapClient(creds);

    for (let i = 0; i < items.length; i++) {
      try {
        const results = await executeOperation(
          this,
          i,
          items,
          client,
          operation,
        );
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

async function executeOperation(
  ctx: IExecuteFunctions,
  itemIndex: number,
  items: INodeExecutionData[],
  client: JmapClient,
  operation: string,
): Promise<IDataObject[]> {
  if (operation === "createDraft") {
    return [await executeCreateDraft(ctx, itemIndex, items, client)];
  }
  if (operation === "importEmail") {
    return [await executeImportEmail(ctx, itemIndex, items, client)];
  }
  if (operation === "moveEmail") {
    return [await executeMoveEmail(ctx, itemIndex, client)];
  }
  if (operation === "listMailboxes") {
    return await executeListMailboxes(ctx, itemIndex, client);
  }
  if (operation === "queryEmails") {
    return await executeQueryEmails(ctx, itemIndex, client);
  }
  if (operation === "getEmail") {
    return [await executeGetEmail(ctx, itemIndex, client)];
  }
  if (operation === "setKeywords") {
    return [await executeSetKeywords(ctx, itemIndex, client)];
  }

  throw new NodeOperationError(
    ctx.getNode(),
    `Unknown operation: ${operation}`,
    {
      itemIndex,
    },
  );
}

async function executeCreateDraft(
  ctx: IExecuteFunctions,
  itemIndex: number,
  items: INodeExecutionData[],
  client: JmapClient,
): Promise<IDataObject> {
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
  const mailbox = await resolveMailboxFromParameters(ctx, itemIndex, client);
  const imported = await client.importEmail({
    raw,
    mailboxId: mailbox.id,
    keywords: { $draft: true },
  });

  return {
    success: true,
    email_id: imported.id,
    emailId: imported.id,
    blob_id: imported.blobId,
    message_id: messageId,
    mailbox_id: mailbox.id,
    mailbox_path: mailbox.path,
    keywords: keywordsToString(imported.keywords ?? { $draft: true }),
    messageSize: Buffer.byteLength(raw),
    attachmentCount: attachments.length,
    attachments: attachments.map((attachment) => attachment.filename),
  };
}

async function executeImportEmail(
  ctx: IExecuteFunctions,
  itemIndex: number,
  items: INodeExecutionData[],
  client: JmapClient,
): Promise<IDataObject> {
  const message = getRawMessage(ctx, itemIndex, items);
  const mailbox = await resolveMailboxFromParameters(ctx, itemIndex, client);
  const receivedAt = getStringParameter(
    ctx,
    "receivedAt",
    itemIndex,
    "",
  ).trim();
  const keywords = keywordsFromString(
    ctx.getNodeParameter("keywords", itemIndex, ""),
  );
  const imported = await client.importEmail({
    raw: message,
    mailboxId: mailbox.id,
    keywords,
    receivedAt: receivedAt || undefined,
  });

  return {
    success: true,
    email_id: imported.id,
    emailId: imported.id,
    blob_id: imported.blobId,
    mailbox_id: mailbox.id,
    mailbox_path: mailbox.path,
    keywords: keywordsToString(imported.keywords ?? keywords),
    messageSize: message.length,
  };
}

async function executeMoveEmail(
  ctx: IExecuteFunctions,
  itemIndex: number,
  client: JmapClient,
): Promise<IDataObject> {
  const emailId = getStringParameter(ctx, "emailId", itemIndex).trim();
  if (!emailId) {
    throw new NodeOperationError(ctx.getNode(), "emailId is required", {
      itemIndex,
    });
  }

  const delimiter = getStringParameter(ctx, "pathDelimiter", itemIndex, "/");
  const destinationType = ctx.getNodeParameter(
    "destinationReferenceType",
    itemIndex,
    "id",
  ) as MailboxReferenceType;
  const destinationRef = getStringParameter(
    ctx,
    "destinationMailboxReference",
    itemIndex,
  );
  const destination = await client.resolveMailbox(
    destinationRef,
    destinationType,
    delimiter,
  );
  const removeMode = ctx.getNodeParameter(
    "removeMode",
    itemIndex,
    "current",
  ) as "current" | "source" | "none";
  const sourceMailboxId = getStringParameter(
    ctx,
    "sourceMailboxId",
    itemIndex,
    "",
  ).trim();

  if (removeMode === "source" && !sourceMailboxId) {
    throw new NodeOperationError(
      ctx.getNode(),
      "sourceMailboxId is required when Remove From is Specified Source Mailbox",
      { itemIndex },
    );
  }

  const moved = await client.moveEmail({
    emailId,
    destinationMailboxId: destination.id,
    removeMode,
    sourceMailboxId: sourceMailboxId || undefined,
  });

  return {
    success: true,
    email_id: moved.emailId,
    emailId: moved.emailId,
    destination_mailbox_id: destination.id,
    destination_mailbox_path: destination.path,
    oldMailboxIds: Object.keys(moved.oldMailboxIds),
    newMailboxIds: Object.keys(moved.newMailboxIds),
  };
}

async function executeListMailboxes(
  ctx: IExecuteFunctions,
  itemIndex: number,
  client: JmapClient,
): Promise<IDataObject[]> {
  const pattern = getStringParameter(ctx, "pattern", itemIndex, "*");
  const delimiter = getStringParameter(ctx, "pathDelimiter", itemIndex, "/");
  const mailboxes = await client.listMailboxes(pattern, delimiter);
  return mailboxes.map((mailbox) => ({
    id: mailbox.id,
    name: mailbox.name,
    path: mailbox.path,
    parentId: mailbox.parentId ?? null,
    role: mailbox.role ?? null,
    sortOrder: mailbox.sortOrder ?? null,
    myRights: mailbox.myRights ?? null,
    isSubscribed: mailbox.isSubscribed ?? null,
    totalEmails: mailbox.totalEmails ?? null,
    unreadEmails: mailbox.unreadEmails ?? null,
    totalThreads: mailbox.totalThreads ?? null,
    unreadThreads: mailbox.unreadThreads ?? null,
  }));
}

async function executeQueryEmails(
  ctx: IExecuteFunctions,
  itemIndex: number,
  client: JmapClient,
): Promise<IDataObject[]> {
  const ids = await client.queryEmails({
    filter: parseJsonObject(
      ctx.getNodeParameter("filterJson", itemIndex, "{}"),
    ),
    sort: parseJsonArray(ctx.getNodeParameter("sortJson", itemIndex, "[]")),
    position: ctx.getNodeParameter("position", itemIndex, 0) as number,
    limit: ctx.getNodeParameter("limit", itemIndex, 10),
  });
  const splitResults = ctx.getNodeParameter(
    "splitResults",
    itemIndex,
    true,
  ) as boolean;

  if (!splitResults) {
    return [{ email_ids: ids, count: ids.length }];
  }
  return ids.map((id) => ({ email_id: id, emailId: id }));
}

async function executeGetEmail(
  ctx: IExecuteFunctions,
  itemIndex: number,
  client: JmapClient,
): Promise<IDataObject> {
  const emailId = getStringParameter(ctx, "emailId", itemIndex).trim();
  const properties = parseAddressList(
    ctx.getNodeParameter("properties", itemIndex, "id,mailboxIds,keywords"),
  );
  if (!emailId) {
    throw new NodeOperationError(ctx.getNode(), "emailId is required", {
      itemIndex,
    });
  }
  return (await client.getEmail(emailId, properties)) as IDataObject;
}

async function executeSetKeywords(
  ctx: IExecuteFunctions,
  itemIndex: number,
  client: JmapClient,
): Promise<IDataObject> {
  const emailId = getStringParameter(ctx, "emailId", itemIndex).trim();
  if (!emailId) {
    throw new NodeOperationError(ctx.getNode(), "emailId is required", {
      itemIndex,
    });
  }
  const mode = ctx.getNodeParameter("keywordMode", itemIndex, "replace") as
    | "replace"
    | "add"
    | "remove";
  const keywords = await client.setKeywords(
    emailId,
    keywordsFromString(ctx.getNodeParameter("keywords", itemIndex, "")),
    mode,
  );
  return {
    success: true,
    email_id: emailId,
    emailId,
    keywords: keywordsToString(keywords),
  };
}

async function resolveMailboxFromParameters(
  ctx: IExecuteFunctions,
  itemIndex: number,
  client: JmapClient,
) {
  const type = ctx.getNodeParameter(
    "mailboxReferenceType",
    itemIndex,
    "role",
  ) as MailboxReferenceType;
  const reference = getStringParameter(ctx, "mailboxReference", itemIndex);
  const delimiter = getStringParameter(ctx, "pathDelimiter", itemIndex, "/");
  return await client.resolveMailbox(reference, type, delimiter);
}

function getRawMessage(
  ctx: IExecuteFunctions,
  itemIndex: number,
  items: INodeExecutionData[],
): Buffer {
  const source = ctx.getNodeParameter("messageSource", itemIndex);
  if (source === "binary") {
    const binaryProperty = ctx.getNodeParameter("binaryProperty", itemIndex);
    const binaryData = items[itemIndex].binary?.[binaryProperty];
    if (!binaryData) {
      throw new NodeOperationError(
        ctx.getNode(),
        `No binary data found in property "${binaryProperty}"`,
        { itemIndex },
      );
    }
    return Buffer.from(binaryData.data, "base64");
  }

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
  return Buffer.from(raw, "utf-8");
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

function mailboxReferenceOptions() {
  return [
    {
      name: "Mailbox ID",
      value: "id",
      description: "Use a JMAP Mailbox id directly",
    },
    {
      name: "Role",
      value: "role",
      description: "Find mailbox by role, e.g. inbox, drafts, archive",
    },
    {
      name: "Path / Name",
      value: "path",
      description: "Find mailbox by assembled path or leaf name",
    },
  ];
}
