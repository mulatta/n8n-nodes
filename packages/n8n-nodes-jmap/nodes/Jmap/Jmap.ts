export const JMAP_CORE_CAPABILITY = "urn:ietf:params:jmap:core";
export const JMAP_MAIL_CAPABILITY = "urn:ietf:params:jmap:mail";

export interface JmapCredentials {
  sessionUrl: string;
  username: string;
  password: string;
  publicOrigin?: string;
}

export interface JmapSession {
  accounts?: Record<string, unknown>;
  primaryAccounts?: Record<string, string>;
  apiUrl: string;
  uploadUrl: string;
}

export interface JmapMailbox {
  id: string;
  name: string;
  parentId?: string | null;
  role?: string | null;
  sortOrder?: number;
  myRights?: Record<string, boolean>;
  isSubscribed?: boolean;
  totalEmails?: number;
  unreadEmails?: number;
  totalThreads?: number;
  unreadThreads?: number;
}

export interface JmapMailboxWithPath extends JmapMailbox {
  path: string;
}

export type MailboxReferenceType = "id" | "role" | "path";

export interface ImportEmailOptions {
  raw: Buffer | string;
  mailboxId: string;
  keywords: Record<string, true>;
  receivedAt?: string;
}

export interface ImportedEmail {
  id: string;
  blobId: string;
  threadId?: string;
  size?: number;
  mailboxIds?: Record<string, true>;
  keywords?: Record<string, true>;
}

export interface MoveEmailOptions {
  emailId: string;
  destinationMailboxId: string;
  removeMode: "current" | "source" | "none";
  sourceMailboxId?: string;
}

export interface QueryEmailsOptions {
  filter?: Record<string, unknown>;
  sort?: Array<Record<string, unknown>>;
  position?: number;
  limit?: number;
}

interface JmapResolvedSession {
  accountId: string;
  apiUrl: string;
  uploadUrl: string;
}

interface FetchResponseLike {
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
}

type FetchLike = (
  url: string,
  init?: RequestInit,
) => Promise<FetchResponseLike>;

const defaultFetch: FetchLike = async (url, init) =>
  globalThis.fetch(url, init);

type MethodCall = [string, Record<string, unknown>, string];
type MethodResponse = [string, Record<string, unknown>, string];

const IMAP_FLAG_TO_JMAP_KEYWORD: Record<string, string> = {
  "\\seen": "$seen",
  "\\flagged": "$flagged",
  "\\answered": "$answered",
  "\\draft": "$draft",
  "\\deleted": "$deleted",
};

export function keywordsFromString(value: unknown): Record<string, true> {
  if (value === undefined || value === null || value === "") return {};
  const tokens = Array.isArray(value)
    ? value.flatMap((entry) => scalarToString(entry).split(/[\s,]+/))
    : scalarToString(value).split(/[\s,]+/);

  const keywords: Record<string, true> = {};
  for (const token of tokens.map((entry) => entry.trim()).filter(Boolean)) {
    const mapped = IMAP_FLAG_TO_JMAP_KEYWORD[token.toLowerCase()] ?? token;
    keywords[mapped] = true;
  }
  return keywords;
}

export function keywordsToString(keywords: Record<string, unknown>): string[] {
  return Object.entries(keywords)
    .filter(([, enabled]) => enabled === true)
    .map(([keyword]) => keyword)
    .sort();
}

export function buildMailboxPaths(
  mailboxes: JmapMailbox[],
  delimiter: string,
): JmapMailboxWithPath[] {
  const byId = new Map(mailboxes.map((mailbox) => [mailbox.id, mailbox]));
  const pathCache = new Map<string, string>();

  const pathFor = (mailbox: JmapMailbox, seen = new Set<string>()): string => {
    const cached = pathCache.get(mailbox.id);
    if (cached) return cached;
    if (seen.has(mailbox.id)) return mailbox.name;
    seen.add(mailbox.id);

    const parent = mailbox.parentId ? byId.get(mailbox.parentId) : undefined;
    const path = parent
      ? `${pathFor(parent, seen)}${delimiter}${mailbox.name}`
      : mailbox.name;
    pathCache.set(mailbox.id, path);
    return path;
  };

  return mailboxes
    .map((mailbox) => ({ ...mailbox, path: pathFor(mailbox) }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

export function matchImapListPattern(
  path: string,
  pattern: string,
  delimiter: string,
): boolean {
  const effectivePattern = pattern || "*";
  const delimiterChars = escapeRegExp(delimiter || "/");
  let regexp = "^";
  for (const char of effectivePattern) {
    if (char === "*") {
      regexp += ".*";
    } else if (char === "%") {
      regexp += `[^${delimiterChars}]*`;
    } else {
      regexp += escapeRegExp(char);
    }
  }
  regexp += "$";
  return new RegExp(regexp).test(path);
}

export function parseJsonObject(
  value: unknown,
  defaultValue: Record<string, unknown> = {},
): Record<string, unknown> {
  if (value === undefined || value === null || value === "")
    return defaultValue;
  const parsed =
    typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (!isRecord(parsed) || Array.isArray(parsed)) {
    throw new Error("Expected a JSON object");
  }
  return parsed;
}

export function parseJsonArray(value: unknown): Array<Record<string, unknown>> {
  if (value === undefined || value === null || value === "") return [];
  const parsed =
    typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (!Array.isArray(parsed)) {
    throw new Error("Expected a JSON array");
  }
  return parsed.map((entry, index) => {
    if (!isRecord(entry) || Array.isArray(entry)) {
      throw new Error(`Expected object at array index ${index}`);
    }
    return entry;
  });
}

export class JmapClient {
  private readonly fetchImpl: FetchLike;
  private resolvedSession?: Promise<JmapResolvedSession>;

  constructor(
    private readonly credentials: JmapCredentials,
    fetchImpl?: FetchLike,
  ) {
    this.fetchImpl = fetchImpl ?? defaultFetch;
  }

  async listMailboxes(
    pattern = "*",
    delimiter = "/",
  ): Promise<JmapMailboxWithPath[]> {
    const mailboxes = await this.getMailboxes();
    return buildMailboxPaths(mailboxes, delimiter).filter((mailbox) =>
      matchImapListPattern(mailbox.path, pattern, delimiter),
    );
  }

  async getMailboxes(): Promise<JmapMailbox[]> {
    const response = await this.call([
      [
        "Mailbox/get",
        {
          accountId: await this.accountId(),
          properties: [
            "id",
            "name",
            "parentId",
            "role",
            "sortOrder",
            "myRights",
            "isSubscribed",
            "totalEmails",
            "unreadEmails",
            "totalThreads",
            "unreadThreads",
          ],
        },
        "0",
      ],
    ]);
    return methodResponseList(response, "Mailbox/get") as JmapMailbox[];
  }

  async resolveMailbox(
    reference: string,
    referenceType: MailboxReferenceType,
    delimiter = "/",
  ): Promise<JmapMailboxWithPath> {
    const trimmed = reference.trim();
    if (!trimmed) throw new Error("Mailbox reference cannot be empty");

    if (referenceType === "id") {
      return { id: trimmed, name: trimmed, path: trimmed };
    }

    const mailboxes = buildMailboxPaths(await this.getMailboxes(), delimiter);
    const mailbox =
      referenceType === "role"
        ? mailboxes.find((entry) => entry.role === trimmed)
        : mailboxes.find(
            (entry) => entry.path === trimmed || entry.name === trimmed,
          );
    if (!mailbox) {
      throw new Error(`Mailbox not found by ${referenceType}: ${trimmed}`);
    }
    return mailbox;
  }

  async importEmail(options: ImportEmailOptions): Promise<ImportedEmail> {
    const blobId = await this.uploadRaw(options.raw);
    const email: Record<string, unknown> = {
      blobId,
      mailboxIds: { [options.mailboxId]: true },
      keywords: options.keywords,
    };
    if (options.receivedAt) email.receivedAt = options.receivedAt;

    const response = await this.call([
      [
        "Email/import",
        {
          accountId: await this.accountId(),
          emails: {
            imported: email,
          },
        },
        "0",
      ],
    ]);
    const payload = methodResponsePayload(response, "Email/import");
    const notCreated = recordAt(payload, "notCreated");
    if (notCreated.imported) {
      throw new Error(
        `Email/import failed: ${JSON.stringify(notCreated.imported)}`,
      );
    }
    const created = recordAt(recordAt(payload, "created"), "imported");
    if (!created.id) {
      throw new Error(
        `Email/import did not create email: ${JSON.stringify(payload)}`,
      );
    }
    return created as unknown as ImportedEmail;
  }

  async moveEmail(options: MoveEmailOptions): Promise<{
    emailId: string;
    oldMailboxIds: Record<string, boolean>;
    newMailboxIds: Record<string, true>;
  }> {
    const oldMailboxIds = await this.getEmailMailboxIds(options.emailId);
    const newMailboxIds: Record<string, true> = {};

    if (options.removeMode === "none") {
      for (const mailboxId of Object.keys(oldMailboxIds)) {
        newMailboxIds[mailboxId] = true;
      }
    } else if (options.removeMode === "source") {
      for (const mailboxId of Object.keys(oldMailboxIds)) {
        if (mailboxId !== options.sourceMailboxId)
          newMailboxIds[mailboxId] = true;
      }
    }

    newMailboxIds[options.destinationMailboxId] = true;

    await this.updateEmail(options.emailId, { mailboxIds: newMailboxIds });
    return { emailId: options.emailId, oldMailboxIds, newMailboxIds };
  }

  async queryEmails(options: QueryEmailsOptions): Promise<string[]> {
    const response = await this.call([
      [
        "Email/query",
        {
          accountId: await this.accountId(),
          filter: options.filter ?? {},
          sort: options.sort ?? [],
          position: options.position ?? 0,
          limit: options.limit ?? 10,
        },
        "0",
      ],
    ]);
    const payload = methodResponsePayload(response, "Email/query");
    return Array.isArray(payload.ids) ? (payload.ids as string[]) : [];
  }

  async getEmail(
    emailId: string,
    properties: string[],
  ): Promise<Record<string, unknown>> {
    const response = await this.call([
      [
        "Email/get",
        {
          accountId: await this.accountId(),
          ids: [emailId],
          properties,
        },
        "0",
      ],
    ]);
    const list = methodResponseList(response, "Email/get");
    const email = list[0];
    if (!isRecord(email)) throw new Error(`Email not found: ${emailId}`);
    return email;
  }

  async setKeywords(
    emailId: string,
    keywords: Record<string, true>,
    mode: "replace" | "add" | "remove",
  ): Promise<Record<string, true>> {
    const current = await this.getEmail(emailId, ["id", "keywords"]);
    const currentKeywords = booleanRecord(current.keywords);
    const nextKeywords: Record<string, true> = {};

    if (mode !== "replace") {
      for (const keyword of Object.keys(currentKeywords)) {
        nextKeywords[keyword] = true;
      }
    }

    if (mode === "remove") {
      for (const keyword of Object.keys(keywords)) {
        delete nextKeywords[keyword];
      }
    } else {
      for (const keyword of Object.keys(keywords)) {
        nextKeywords[keyword] = true;
      }
    }

    await this.updateEmail(emailId, { keywords: nextKeywords });
    return nextKeywords;
  }

  private async accountId(): Promise<string> {
    return (await this.getSession()).accountId;
  }

  private async uploadRaw(raw: Buffer | string): Promise<string> {
    const session = await this.getSession();
    const uploadUrl = expandUrlTemplate(session.uploadUrl, {
      accountId: session.accountId,
      type: "message/rfc822",
      name: "message.eml",
    });
    const response = await this.fetchJson(uploadUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "message/rfc822",
      },
      body: raw,
    });
    const blobId = response.blobId;
    if (typeof blobId !== "string" || !blobId) {
      throw new Error(
        `JMAP upload response did not include blobId: ${JSON.stringify(response)}`,
      );
    }
    return blobId;
  }

  private async getEmailMailboxIds(
    emailId: string,
  ): Promise<Record<string, boolean>> {
    const email = await this.getEmail(emailId, ["id", "mailboxIds"]);
    return booleanRecord(email.mailboxIds);
  }

  private async updateEmail(
    emailId: string,
    update: Record<string, unknown>,
  ): Promise<void> {
    const response = await this.call([
      [
        "Email/set",
        {
          accountId: await this.accountId(),
          update: {
            [emailId]: update,
          },
        },
        "0",
      ],
    ]);
    const payload = methodResponsePayload(response, "Email/set");
    const notUpdated = recordAt(payload, "notUpdated");
    if (notUpdated[emailId]) {
      throw new Error(
        `Email/set failed: ${JSON.stringify(notUpdated[emailId])}`,
      );
    }
  }

  private async call(methodCalls: MethodCall[]): Promise<MethodResponse[]> {
    const session = await this.getSession();
    const response = await this.fetchJson(session.apiUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        using: [JMAP_CORE_CAPABILITY, JMAP_MAIL_CAPABILITY],
        methodCalls,
      }),
    });
    if (!Array.isArray(response.methodResponses)) {
      throw new Error(
        `JMAP response did not include methodResponses: ${JSON.stringify(response)}`,
      );
    }
    return response.methodResponses as MethodResponse[];
  }

  private async getSession(): Promise<JmapResolvedSession> {
    this.resolvedSession ??= this.loadSession();
    return this.resolvedSession;
  }

  private async loadSession(): Promise<JmapResolvedSession> {
    const session = (await this.fetchJson(this.credentials.sessionUrl, {
      headers: { Accept: "application/json" },
    })) as unknown as JmapSession;

    const accountId =
      session.primaryAccounts?.[JMAP_MAIL_CAPABILITY] ??
      Object.keys(session.accounts ?? {})[0];
    if (!accountId) throw new Error("JMAP mail account id not found");
    if (!session.apiUrl) throw new Error("JMAP session did not include apiUrl");
    if (!session.uploadUrl)
      throw new Error("JMAP session did not include uploadUrl");

    return {
      accountId,
      apiUrl: rewriteOrigin(session.apiUrl, this.credentials.publicOrigin),
      uploadUrl: rewriteOrigin(
        session.uploadUrl,
        this.credentials.publicOrigin,
      ),
    };
  }

  private async fetchJson(
    url: string,
    options: RequestInit = {},
  ): Promise<Record<string, unknown>> {
    const headers = new Headers(options.headers);
    headers.set(
      "Authorization",
      `Basic ${Buffer.from(`${this.credentials.username}:${this.credentials.password}`).toString("base64")}`,
    );
    const response = await this.fetchImpl(url, { ...options, headers });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `JMAP HTTP ${response.status} ${response.statusText}: ${text.slice(0, 1000)}`,
      );
    }
    if (!text) return {};
    const parsed = JSON.parse(text) as unknown;
    if (!isRecord(parsed) || Array.isArray(parsed)) {
      throw new Error("JMAP response was not a JSON object");
    }
    return parsed;
  }
}

function methodResponsePayload(
  responses: MethodResponse[],
  methodName: string,
): Record<string, unknown> {
  const response = responses.find((entry) => entry[0] === methodName);
  if (!response) throw new Error(`JMAP response missing ${methodName}`);
  return response[1];
}

function methodResponseList(
  responses: MethodResponse[],
  methodName: string,
): unknown[] {
  const payload = methodResponsePayload(responses, methodName);
  return Array.isArray(payload.list) ? payload.list : [];
}

function recordAt(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const value = record[key];
  return isRecord(value) && !Array.isArray(value) ? value : {};
}

function booleanRecord(value: unknown): Record<string, boolean> {
  if (!isRecord(value) || Array.isArray(value)) return {};
  const result: Record<string, boolean> = {};
  for (const [key, enabled] of Object.entries(value)) {
    if (enabled === true) result[key] = true;
  }
  return result;
}

function rewriteOrigin(url: string, publicOrigin?: string): string {
  if (!publicOrigin) return url;
  const origin = publicOrigin.replace(/\/$/, "");
  return String(url).replace(/^https?:\/\/[^/]+(?=\/)/, origin);
}

function expandUrlTemplate(
  template: string,
  values: Record<string, string>,
): string {
  let expanded = template;
  for (const [key, value] of Object.entries(values)) {
    expanded = expanded.replaceAll(`{${key}}`, encodeURIComponent(value));
  }
  return expanded;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function scalarToString(value: unknown): string {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
