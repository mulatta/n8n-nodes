import { NodeConnectionTypes, NodeOperationError } from "n8n-workflow";

import type {
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from "n8n-workflow";

const DEFAULT_TIMEOUT_SECONDS = 60;

interface RestateRequest {
  operation: "call" | "send";
  path: string;
  payload: unknown;
  idempotencyKey: string;
  timeoutMs: number;
}

interface RestateResponse {
  statusCode: number;
  body: unknown;
}

class RestateHttpError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly responseText: string,
  ) {
    super(message);
    this.name = "RestateHttpError";
  }
}

export class Restate implements INodeType {
  description: INodeTypeDescription = {
    displayName: "Restate",
    name: "restate",
    icon: "file:restate.svg",
    group: ["transform"],
    version: 1,
    subtitle: "={{$parameter.operation}} {{$parameter.path}}",
    description: "Invoke Restate handlers through HTTP ingress",
    defaults: {
      name: "Restate",
    },
    usableAsTool: true,
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    credentials: [
      {
        name: "restateApi",
        required: true,
      },
    ],
    properties: [
      {
        displayName: "Operation",
        name: "operation",
        type: "options",
        options: [
          {
            name: "Call",
            value: "call",
            description: "Invoke a handler and wait for its response",
          },
          {
            name: "Send",
            value: "send",
            description:
              "Enqueue a fire-and-forget invocation and return its invocation ID",
          },
        ],
        default: "call",
      },
      {
        displayName: "Invocation Path",
        name: "path",
        type: "string",
        default:
          "={{ $json.restatePath || $json.path || 'xLikedMedia/bootstrap' }}",
        required: true,
        placeholder: "xLikedMedia/bootstrap",
        description:
          "Path below Restate ingress, for example service/handler, object/key/handler, or workflow/id/run.",
      },
      {
        displayName: "Payload",
        name: "payload",
        type: "json",
        default: "={{ JSON.stringify($json.payload ?? $json) }}",
        description: "JSON request payload passed to the Restate handler",
      },
      {
        displayName: "Idempotency Key",
        name: "idempotencyKey",
        type: "string",
        default: "={{ $json.idempotencyKey || '' }}",
        description:
          "Optional Restate Idempotency-Key header for deduplicating retries",
      },
      {
        displayName: "Timeout Seconds",
        name: "timeoutSeconds",
        type: "number",
        default: DEFAULT_TIMEOUT_SECONDS,
        typeOptions: { minValue: 1 },
        description: "Maximum HTTP request runtime",
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const credentials = await this.getCredentials("restateApi");
    const baseUrl = normalizeBaseUrl(valueToString(credentials.baseUrl));
    const bearerToken = valueToString(credentials.bearerToken).trim();
    const returnData: INodeExecutionData[] = [];

    for (let i = 0; i < items.length; i++) {
      let request: RestateRequest | undefined;
      try {
        request = buildRequest(this, i);
        const response = await invokeRestate(baseUrl, bearerToken, request);
        returnData.push(
          ...jsonItems(this, responseToJson(request, response), i),
        );
      } catch (error) {
        if (this.continueOnFail()) {
          returnData.push(
            ...jsonItems(this, errorToJson(error, request?.path || ""), i),
          );
          continue;
        }
        if (error instanceof NodeOperationError) throw error;
        throw new NodeOperationError(
          this.getNode(),
          error instanceof Error ? error.message : String(error),
          { itemIndex: i },
        );
      }
    }

    return [returnData];
  }
}

function buildRequest(
  ctx: IExecuteFunctions,
  itemIndex: number,
): RestateRequest {
  const operation = ctx.getNodeParameter("operation", itemIndex, "call");
  if (operation !== "call" && operation !== "send") {
    throw new NodeOperationError(
      ctx.getNode(),
      `Unsupported operation: ${String(operation)}`,
      { itemIndex },
    );
  }

  const path = normalizeInvocationPath(
    valueToString(ctx.getNodeParameter("path", itemIndex, "")),
    operation,
  );
  if (!path) {
    throw new NodeOperationError(
      ctx.getNode(),
      "Invocation Path cannot be empty",
      {
        itemIndex,
      },
    );
  }

  const payload = parsePayload(
    ctx.getNodeParameter("payload", itemIndex, null),
  );
  const idempotencyKey = valueToString(
    ctx.getNodeParameter("idempotencyKey", itemIndex, ""),
  ).trim();
  const timeoutSeconds = Number(
    ctx.getNodeParameter("timeoutSeconds", itemIndex, DEFAULT_TIMEOUT_SECONDS),
  );
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    throw new NodeOperationError(
      ctx.getNode(),
      "Timeout Seconds must be greater than zero",
      { itemIndex },
    );
  }

  return {
    operation,
    path,
    payload,
    idempotencyKey,
    timeoutMs: timeoutSeconds * 1000,
  };
}

async function invokeRestate(
  baseUrl: string,
  bearerToken: string,
  request: RestateRequest,
): Promise<RestateResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/${request.path}`, {
      method: "POST",
      headers: buildHeaders(bearerToken, request.idempotencyKey),
      body: JSON.stringify(request.payload),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new RestateHttpError(
        `Restate HTTP ${response.status}: ${text.slice(0, 500)}`,
        response.status,
        text,
      );
    }
    return {
      statusCode: response.status,
      body: parseResponseBody(text),
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Restate request timed out after ${request.timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function buildHeaders(
  bearerToken: string,
  idempotencyKey: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
  };
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  if (bearerToken) headers.authorization = `Bearer ${bearerToken}`;
  return headers;
}

function parsePayload(value: unknown): unknown {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(
      `Payload must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function parseResponseBody(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

function responseToJson(
  request: RestateRequest,
  response: RestateResponse,
): IDataObject {
  return {
    success: true,
    operation: request.operation,
    path: request.path,
    statusCode: response.statusCode,
    result: response.body as IDataObject,
  };
}

function errorToJson(error: unknown, path: string): IDataObject {
  const message = error instanceof Error ? error.message : String(error);
  return {
    success: false,
    path,
    statusCode:
      error instanceof RestateHttpError ? error.statusCode : undefined,
    error: message,
  };
}

function jsonItems(
  ctx: IExecuteFunctions,
  data: IDataObject,
  itemIndex: number,
): INodeExecutionData[] {
  return ctx.helpers.constructExecutionMetaData(
    ctx.helpers.returnJsonArray(data),
    {
      itemData: { item: itemIndex },
    },
  );
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed)
    throw new Error("Restate Ingress Base URL credential is required");
  try {
    new URL(trimmed);
  } catch (error) {
    throw new Error(
      `Restate Ingress Base URL is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return trimmed;
}

function normalizeInvocationPath(
  value: string,
  operation: "call" | "send",
): string {
  const trimmed = value.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  if (!trimmed) return "";
  if (operation === "send" && !trimmed.endsWith("/send")) {
    return `${trimmed}/send`;
  }
  return trimmed;
}

function valueToString(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return value.toString();
  }
  throw new Error("Expected string-compatible value");
}
