import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";

import { NodeConnectionTypes, NodeOperationError } from "n8n-workflow";

import type {
  IBinaryData,
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from "n8n-workflow";

const DEFAULT_OUTPUT_DIRECTORY =
  "/var/lib/n8n/.cache/n8n-nodes-ytdlp/downloads";
const DEFAULT_OUTPUT_TEMPLATE =
  "%(upload_date>%Y-%m-%d)s_%(uploader)s_%(id)s.%(ext)s";

interface YtDlpResult {
  stdout: string;
  stderr: string;
}

interface InfoJson extends IDataObject {
  id?: string;
  extractor?: string;
  title?: string;
  uploader?: string;
  channel?: string;
  upload_date?: string;
  duration?: number;
  ext?: string;
  webpage_url?: string;
  formats?: IDataObject[];
}

export class YtDlp implements INodeType {
  description: INodeTypeDescription = {
    displayName: "yt-dlp",
    name: "ytDlp",
    icon: "file:ytdlp.svg",
    group: ["transform"],
    version: 1,
    subtitle: "={{$parameter.operation}}",
    description: "Get metadata or download media using yt-dlp",
    defaults: {
      name: "yt-dlp",
    },
    usableAsTool: true,
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    credentials: [
      {
        name: "ytDlpCookieFile",
        required: true,
        displayOptions: {
          show: {
            authentication: ["cookieFile"],
          },
        },
      },
    ],
    properties: [
      {
        displayName: "Operation",
        name: "operation",
        type: "options",
        options: [
          { name: "Download", value: "download" },
          { name: "Get Info", value: "getInfo" },
        ],
        default: "download",
      },
      {
        displayName: "URL",
        name: "url",
        type: "string",
        default: "={{$json.url}}",
        required: true,
        description: "Media URL supported by yt-dlp",
      },
      {
        displayName: "Authentication",
        name: "authentication",
        type: "options",
        options: [
          { name: "None", value: "none" },
          { name: "Cookie File", value: "cookieFile" },
        ],
        default: "none",
      },
      {
        displayName: "Output Mode",
        name: "outputMode",
        type: "options",
        options: [
          { name: "File Path", value: "filePath" },
          { name: "Binary", value: "binary" },
          { name: "Both", value: "both" },
        ],
        default: "filePath",
        displayOptions: { show: { operation: ["download"] } },
        description:
          "File Path leaves the downloaded file on disk for later workflow steps",
      },
      {
        displayName: "Output Directory",
        name: "outputDirectory",
        type: "string",
        default: DEFAULT_OUTPUT_DIRECTORY,
        required: true,
        displayOptions: { show: { operation: ["download"] } },
        description: "Directory where yt-dlp writes downloaded files",
      },
      {
        displayName: "Output Template",
        name: "outputTemplate",
        type: "string",
        default: DEFAULT_OUTPUT_TEMPLATE,
        required: true,
        displayOptions: { show: { operation: ["download"] } },
        description:
          "yt-dlp output template relative to Output Directory unless absolute",
      },
      {
        displayName: "Format",
        name: "format",
        type: "string",
        default: "bestvideo*+bestaudio/best",
        displayOptions: { show: { operation: ["download"] } },
        description:
          "Value passed to yt-dlp -f. Leave empty to use yt-dlp default.",
      },
      {
        displayName: "Download Archive",
        name: "downloadArchive",
        type: "string",
        default: "",
        displayOptions: { show: { operation: ["download"] } },
        description:
          "Optional yt-dlp download archive path used to skip already downloaded media",
      },
      {
        displayName: "Keep Local File",
        name: "keepLocalFile",
        type: "boolean",
        default: true,
        displayOptions: { show: { operation: ["download"] } },
        description:
          "Whether to keep the local file after returning binary data. Disable only when Output Mode is Binary.",
      },
      {
        displayName: "yt-dlp Path",
        name: "ytdlpPath",
        type: "string",
        default: "",
        placeholder: "Defaults to $YT_DLP_PATH or yt-dlp",
        description: "Path to yt-dlp executable",
      },
      {
        displayName: "Extra Arguments",
        name: "extraArguments",
        type: "string",
        default: "",
        typeOptions: { rows: 4 },
        placeholder: "--merge-output-format\nmp4",
        description:
          "Additional yt-dlp arguments, one argument per line. Values are passed without a shell.",
      },
      {
        displayName: "Timeout Seconds",
        name: "timeoutSeconds",
        type: "number",
        default: 600,
        typeOptions: { minValue: 1 },
        description: "Maximum yt-dlp runtime per command",
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    for (let i = 0; i < items.length; i++) {
      const sourceUrl = valueToString(this.getNodeParameter("url", i)).trim();
      try {
        if (!sourceUrl) {
          throw new NodeOperationError(this.getNode(), "URL cannot be empty", {
            itemIndex: i,
          });
        }

        const operation = this.getNodeParameter("operation", i);
        const ytdlpPath = resolveYtDlpPath(
          this.getNodeParameter("ytdlpPath", i, "") as string,
        );
        const timeoutMs =
          Number(this.getNodeParameter("timeoutSeconds", i, 600)) * 1000;
        const authArgs = await buildAuthenticationArgs(this, i);
        const extraArgs = parseExtraArguments(
          this.getNodeParameter("extraArguments", i, "") as string,
        );

        if (operation === "getInfo") {
          const info = await getInfo(
            ytdlpPath,
            sourceUrl,
            [...authArgs, ...extraArgs],
            timeoutMs,
          );
          returnData.push(...jsonItems(this, infoToJson(info, sourceUrl), i));
          continue;
        }

        if (operation !== "download") {
          throw new NodeOperationError(
            this.getNode(),
            `Unsupported operation: ${operation}`,
            { itemIndex: i },
          );
        }

        const result = await downloadItem(
          this,
          i,
          ytdlpPath,
          sourceUrl,
          authArgs,
          extraArgs,
          timeoutMs,
        );
        returnData.push(
          ...this.helpers.constructExecutionMetaData([result], {
            itemData: { item: i },
          }),
        );
      } catch (error) {
        if (this.continueOnFail()) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          returnData.push(
            ...jsonItems(
              this,
              {
                success: false,
                sourceUrl,
                error: errorMessage,
              },
              i,
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

async function downloadItem(
  ctx: IExecuteFunctions,
  itemIndex: number,
  ytdlpPath: string,
  sourceUrl: string,
  authArgs: string[],
  extraArgs: string[],
  timeoutMs: number,
): Promise<INodeExecutionData> {
  const outputMode = ctx.getNodeParameter(
    "outputMode",
    itemIndex,
    "filePath",
  ) as string;
  const outputDirectory = ctx.getNodeParameter(
    "outputDirectory",
    itemIndex,
    DEFAULT_OUTPUT_DIRECTORY,
  ) as string;
  const outputTemplate = ctx.getNodeParameter(
    "outputTemplate",
    itemIndex,
    DEFAULT_OUTPUT_TEMPLATE,
  ) as string;
  const format = valueToString(ctx.getNodeParameter("format", itemIndex, ""));
  const downloadArchive = valueToString(
    ctx.getNodeParameter("downloadArchive", itemIndex, ""),
  ).trim();
  const keepLocalFile = Boolean(
    ctx.getNodeParameter("keepLocalFile", itemIndex, true),
  );

  await fsp.mkdir(outputDirectory, { recursive: true });
  if (downloadArchive) {
    await fsp.mkdir(path.dirname(downloadArchive), { recursive: true });
  }

  const info = await getInfo(
    ytdlpPath,
    sourceUrl,
    [...authArgs, ...extraArgs],
    timeoutMs,
  );
  const resolvedTemplate = path.isAbsolute(outputTemplate)
    ? outputTemplate
    : path.join(outputDirectory, outputTemplate);

  const args = ["--no-warnings", "--no-playlist"];
  if (downloadArchive) {
    args.push("--download-archive", downloadArchive);
  }
  if (format.trim()) {
    args.push("-f", format.trim());
  }
  args.push(
    "--print",
    "after_move:filepath",
    "-o",
    resolvedTemplate,
    ...authArgs,
    ...extraArgs,
    sourceUrl,
  );

  const { stdout } = await runYtDlp(ytdlpPath, args, timeoutMs);
  const filePath = lastNonEmptyLine(stdout);
  const downloaded = Boolean(filePath);

  const json: IDataObject = {
    ...infoToJson(info, sourceUrl),
    operation: "download",
    downloaded,
    archivePath: downloadArchive || undefined,
  };

  const binary: Record<string, IBinaryData> = {};
  if (filePath) {
    json.filePath = filePath;
    json.fileSize = fs.statSync(filePath).size;
    json.ext = path.extname(filePath).slice(1) || info.ext;

    if (outputMode === "binary" || outputMode === "both") {
      binary.data = await ctx.helpers.prepareBinaryData(
        fs.createReadStream(filePath),
        path.basename(filePath),
      );
      if (outputMode === "binary" && !keepLocalFile) {
        await fsp.unlink(filePath);
        delete json.filePath;
      }
    }
  }

  return Object.keys(binary).length > 0 ? { json, binary } : { json };
}

async function buildAuthenticationArgs(
  ctx: IExecuteFunctions,
  itemIndex: number,
): Promise<string[]> {
  const authentication = ctx.getNodeParameter(
    "authentication",
    itemIndex,
    "none",
  ) as string;
  if (authentication !== "cookieFile") {
    return [];
  }

  const credentials = await ctx.getCredentials("ytDlpCookieFile");
  const cookieFilePath = valueToString(credentials.cookieFilePath).trim();
  if (!cookieFilePath) {
    throw new NodeOperationError(
      ctx.getNode(),
      "Cookie File authentication requires a cookie file path credential",
      { itemIndex },
    );
  }
  if (!fs.existsSync(cookieFilePath)) {
    throw new NodeOperationError(
      ctx.getNode(),
      `Cookie file not found: ${cookieFilePath}`,
      { itemIndex },
    );
  }

  return ["--cookies", cookieFilePath];
}

async function getInfo(
  ytdlpPath: string,
  sourceUrl: string,
  extraArgs: string[],
  timeoutMs: number,
): Promise<InfoJson> {
  const { stdout } = await runYtDlp(
    ytdlpPath,
    [
      "--dump-single-json",
      "--no-download",
      "--no-warnings",
      ...extraArgs,
      sourceUrl,
    ],
    timeoutMs,
  );
  try {
    return JSON.parse(stdout) as InfoJson;
  } catch (error) {
    throw new Error(
      `yt-dlp returned invalid JSON: ${String(error)}; output=${stdout.slice(0, 500)}`,
    );
  }
}

function runYtDlp(
  ytdlpPath: string,
  args: string[],
  timeoutMs: number,
): Promise<YtDlpResult> {
  return new Promise((resolve, reject) => {
    execFile(
      ytdlpPath,
      args,
      {
        timeout: timeoutMs,
        maxBuffer: 100 * 1024 * 1024,
        windowsHide: true,
        env: process.env,
      },
      (error, stdout, stderr) => {
        if (error) {
          const message = stderr.trim() || error.message;
          reject(new Error(message));
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}

function infoToJson(info: InfoJson, sourceUrl: string): IDataObject {
  return {
    success: true,
    operation: "getInfo",
    sourceUrl,
    webpageUrl: info.webpage_url ?? sourceUrl,
    id: info.id,
    extractor: info.extractor,
    title: info.title,
    uploader: info.uploader ?? info.channel,
    uploadDate: info.upload_date,
    duration: info.duration,
    ext: info.ext,
    formats: info.formats,
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

function parseExtraArguments(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function resolveYtDlpPath(parameterValue: string): string {
  return parameterValue.trim() || process.env.YT_DLP_PATH || "yt-dlp";
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

function lastNonEmptyLine(value: string): string | undefined {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
}
