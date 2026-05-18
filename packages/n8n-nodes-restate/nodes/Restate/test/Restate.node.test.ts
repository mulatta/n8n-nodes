import * as http from "node:http";

import { createMockExecuteFunctions } from "../../../../../test/helpers";
import { Restate } from "../Restate.node";

interface RequestRecord {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

describe("Restate node", () => {
  let server: http.Server;
  let baseUrl: string;
  let requests: RequestRecord[];

  beforeEach(async () => {
    requests = [];
    server = http.createServer((req, res) => {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        requests.push({
          method: req.method || "",
          url: req.url || "",
          headers: req.headers,
          body,
        });

        if (req.url === "/failure") {
          res.writeHead(503, { "content-type": "text/plain" });
          res.end("service unavailable");
          return;
        }

        if (req.url?.endsWith("/send")) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              invocationId: "inv_123",
              status: "Accepted",
            }),
          );
          return;
        }

        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            received: parseJson(body),
          }),
        );
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (typeof address !== "object" || address === null) {
      throw new Error("expected TCP server address");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("calls a Restate handler with JSON payload and idempotency key", async () => {
    const node = new Restate();
    const ctx = createMockExecuteFunctions(
      {
        operation: "call",
        path: "xLikedMedia/bootstrap",
        payload: '{"pageSize":100,"maxPages":8}',
        idempotencyKey: "bootstrap-1",
        timeoutSeconds: 10,
      },
      { restateApi: { baseUrl, bearerToken: "secret-token" } },
    );

    const [[result]] = await node.execute.call(ctx);

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: "POST",
      url: "/xLikedMedia/bootstrap",
      body: '{"pageSize":100,"maxPages":8}',
    });
    expect(requests[0].headers["idempotency-key"]).toBe("bootstrap-1");
    expect(requests[0].headers.authorization).toBe("Bearer secret-token");
    expect(result.json).toMatchObject({
      success: true,
      operation: "call",
      path: "xLikedMedia/bootstrap",
      statusCode: 200,
      result: { received: { pageSize: 100, maxPages: 8 } },
    });
  });

  it("sends a fire-and-forget invocation by appending /send", async () => {
    const node = new Restate();
    const ctx = createMockExecuteFunctions(
      {
        operation: "send",
        path: "/xLikedMedia/drain/",
        payload: { limit: 10 },
        idempotencyKey: "drain-1",
        timeoutSeconds: 10,
      },
      { restateApi: { baseUrl } },
    );

    const [[result]] = await node.execute.call(ctx);

    expect(requests[0]).toMatchObject({
      method: "POST",
      url: "/xLikedMedia/drain/send",
      body: '{"limit":10}',
    });
    expect(result.json).toMatchObject({
      success: true,
      operation: "send",
      result: { invocationId: "inv_123", status: "Accepted" },
    });
  });

  it("rejects empty send invocation paths", async () => {
    const node = new Restate();
    const ctx = createMockExecuteFunctions(
      {
        operation: "send",
        path: "  ",
        payload: {},
        idempotencyKey: "",
        timeoutSeconds: 10,
      },
      { restateApi: { baseUrl } },
    );

    await expect(node.execute.call(ctx)).rejects.toThrow(
      /Invocation Path cannot be empty/,
    );
  });

  it("rejects invalid JSON payloads", async () => {
    const node = new Restate();
    const ctx = createMockExecuteFunctions(
      {
        operation: "call",
        path: "xLikedMedia/bootstrap",
        payload: "{not-json}",
        idempotencyKey: "",
        timeoutSeconds: 10,
      },
      { restateApi: { baseUrl } },
    );

    await expect(node.execute.call(ctx)).rejects.toThrow(
      /Payload must be valid JSON/,
    );
  });

  it("returns HTTP errors as item errors when continue on fail is enabled", async () => {
    const node = new Restate();
    const ctx = createMockExecuteFunctions(
      {
        operation: "call",
        path: "failure",
        payload: {},
        idempotencyKey: "",
        timeoutSeconds: 10,
      },
      { restateApi: { baseUrl } },
      { continueOnFail: true },
    );

    const [[result]] = await node.execute.call(ctx);

    expect(result.json).toMatchObject({
      success: false,
      statusCode: 503,
      error: "Restate HTTP 503: service unavailable",
    });
  });
});
