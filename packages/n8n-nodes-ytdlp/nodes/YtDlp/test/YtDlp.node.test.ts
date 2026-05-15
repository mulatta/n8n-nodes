import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { createMockExecuteFunctions } from "../../../../../test/helpers";
import { YtDlp } from "../YtDlp.node";

describe("YtDlp node", () => {
  let tmpDir: string;
  let fakeYtDlp: string;
  let callsFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ytdlp-node-test-"));
    callsFile = path.join(tmpDir, "calls.jsonl");
    fakeYtDlp = path.join(tmpDir, "yt-dlp-fake.js");
    fs.writeFileSync(
      fakeYtDlp,
      `#!${process.execPath}
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CALLS_FILE, JSON.stringify(args) + '\\n');
const url = args[args.length - 1];
if (args.includes('--dump-single-json')) {
  console.log(JSON.stringify({
    id: '1234567890',
    extractor: 'twitter',
    title: 'Tweet video',
    uploader: 'example',
    upload_date: '20260515',
    duration: 12.4,
    ext: 'mp4',
    webpage_url: url,
    formats: [{ format_id: 'http-1', ext: 'mp4', height: 720 }]
  }));
  process.exit(0);
}
const outputIndex = args.indexOf('-o');
const template = args[outputIndex + 1];
const output = template.replace('%(ext)s', 'mp4');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, 'video');
console.log(output);
`,
      { mode: 0o755 },
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("gets metadata without downloading", async () => {
    const node = new YtDlp();
    const ctx = createMockExecuteFunctions({
      operation: "getInfo",
      url: "https://x.com/example/status/1234567890",
      ytdlpPath: fakeYtDlp,
      authentication: "none",
      outputMode: "filePath",
      outputDirectory: tmpDir,
      outputTemplate: "%(id)s.%(ext)s",
      format: "best",
      downloadArchive: "",
      extraArguments: "",
      timeoutSeconds: 30,
    });
    process.env.CALLS_FILE = callsFile;

    const [[result]] = await node.execute.call(ctx);

    expect(result.json).toMatchObject({
      success: true,
      operation: "getInfo",
      id: "1234567890",
      extractor: "twitter",
      title: "Tweet video",
    });
    const calls = readCalls(callsFile);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("--dump-single-json");
    expect(calls[0]).not.toContain("-o");
  });

  it("downloads to a file path and returns metadata", async () => {
    const archivePath = path.join(tmpDir, "archive.txt");
    const node = new YtDlp();
    const ctx = createMockExecuteFunctions({
      operation: "download",
      url: "https://x.com/example/status/1234567890",
      ytdlpPath: fakeYtDlp,
      authentication: "none",
      outputMode: "filePath",
      outputDirectory: tmpDir,
      outputTemplate: "%(id)s.%(ext)s",
      format: "best",
      downloadArchive: archivePath,
      extraArguments: "--merge-output-format\nmp4",
      timeoutSeconds: 30,
    });
    process.env.CALLS_FILE = callsFile;

    const [[result]] = await node.execute.call(ctx);

    expect(result.json).toMatchObject({
      success: true,
      operation: "download",
      id: "1234567890",
      downloaded: true,
      filePath: path.join(tmpDir, "%(id)s.mp4"),
      archivePath,
    });
    expect(fs.existsSync(result.json.filePath as string)).toBe(true);
    const calls = readCalls(callsFile);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(
      expect.arrayContaining([
        "--download-archive",
        archivePath,
        "--print",
        "after_move:filepath",
        "--merge-output-format",
        "mp4",
      ]),
    );
  });

  it("passes cookie file credentials only when enabled", async () => {
    const cookieFile = path.join(tmpDir, "cookies.txt");
    fs.writeFileSync(cookieFile, "# Netscape HTTP Cookie File\n");
    const node = new YtDlp();
    const ctx = createMockExecuteFunctions(
      {
        operation: "getInfo",
        url: "https://x.com/example/status/1234567890",
        ytdlpPath: fakeYtDlp,
        authentication: "cookieFile",
        outputMode: "filePath",
        outputDirectory: tmpDir,
        outputTemplate: "%(id)s.%(ext)s",
        format: "best",
        downloadArchive: "",
        extraArguments: "",
        timeoutSeconds: 30,
      },
      { ytDlpCookieFile: { cookieFilePath: cookieFile } },
    );
    process.env.CALLS_FILE = callsFile;

    await node.execute.call(ctx);

    expect(readCalls(callsFile)[0]).toEqual(
      expect.arrayContaining(["--cookies", cookieFile]),
    );
  });

  it("validates cookie text and removes temporary files", async () => {
    const cookieText = [
      "# Netscape HTTP Cookie File",
      ".x.com\tTRUE\t/\tTRUE\t1893456000\tauth_token\tsecret-auth",
      ".x.com\tTRUE\t/\tTRUE\t1893456000\tct0\tsecret-ct0",
      "",
    ].join("\n");
    const node = new YtDlp();
    const ctx = createMockExecuteFunctions({
      operation: "getInfo",
      url: "https://x.com/example/status/1234567890",
      ytdlpPath: fakeYtDlp,
      authentication: "cookieText",
      cookieText,
      requiredCookieDomains: "x.com\ntwitter.com",
      requiredCookieNames: "auth_token\nct0",
      outputMode: "filePath",
      outputDirectory: tmpDir,
      outputTemplate: "%(id)s.%(ext)s",
      format: "best",
      downloadArchive: "",
      extraArguments: "",
      timeoutSeconds: 30,
    });
    process.env.CALLS_FILE = callsFile;

    await node.execute.call(ctx);

    const calls = readCalls(callsFile);
    const cookiePath = calls[0][calls[0].indexOf("--cookies") + 1];
    expect(cookiePath).toContain("n8n-ytdlp-cookies-");
    expect(fs.existsSync(cookiePath)).toBe(false);
  });

  it("rejects cookie text without required cookies", async () => {
    const node = new YtDlp();
    const ctx = createMockExecuteFunctions({
      operation: "getInfo",
      url: "https://x.com/example/status/1234567890",
      ytdlpPath: fakeYtDlp,
      authentication: "cookieText",
      cookieText:
        ".x.com\tTRUE\t/\tTRUE\t1893456000\tauth_token\tsecret-auth\n",
      requiredCookieDomains: "x.com\ntwitter.com",
      requiredCookieNames: "auth_token\nct0",
      outputMode: "filePath",
      outputDirectory: tmpDir,
      outputTemplate: "%(id)s.%(ext)s",
      format: "best",
      downloadArchive: "",
      extraArguments: "",
      timeoutSeconds: 30,
    });

    await expect(node.execute.call(ctx)).rejects.toThrow(
      "Cookie Text is missing required cookie names: ct0",
    );
  });

  it("returns item errors when continueOnFail is enabled", async () => {
    fs.writeFileSync(
      fakeYtDlp,
      `#!${process.execPath}\nconsole.error('boom'); process.exit(1);\n`,
      { mode: 0o755 },
    );
    const node = new YtDlp();
    const ctx = createMockExecuteFunctions(
      {
        operation: "getInfo",
        url: "https://x.com/example/status/1234567890",
        ytdlpPath: fakeYtDlp,
        authentication: "none",
        outputMode: "filePath",
        outputDirectory: tmpDir,
        outputTemplate: "%(id)s.%(ext)s",
        format: "best",
        downloadArchive: "",
        extraArguments: "",
        timeoutSeconds: 30,
      },
      undefined,
      { continueOnFail: true },
    );

    const [[result]] = await node.execute.call(ctx);

    expect(result.json).toMatchObject({
      success: false,
      sourceUrl: "https://x.com/example/status/1234567890",
    });
    expect(result.json.error).toEqual(expect.stringContaining("boom"));
  });
});

function readCalls(file: string): string[][] {
  return fs
    .readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as string[]);
}
