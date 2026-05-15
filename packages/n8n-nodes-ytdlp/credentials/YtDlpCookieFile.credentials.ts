import type { ICredentialType, INodeProperties } from "n8n-workflow";

export class YtDlpCookieFile implements ICredentialType {
  name = "ytDlpCookieFile";

  displayName = "yt-dlp Cookie File";

  documentationUrl =
    "https://github.com/yt-dlp/yt-dlp#authentication-with-cookies";

  properties: INodeProperties[] = [
    {
      displayName: "Cookie File Path",
      name: "cookieFilePath",
      type: "string",
      typeOptions: { password: true },
      default: "",
      placeholder:
        "/var/lib/n8n/.local/state/n8n-nodes-ytdlp/cookies/x.netscape.txt",
      required: true,
      description:
        "Path to a Netscape-format cookie file readable by the n8n service user",
    },
  ];
}
