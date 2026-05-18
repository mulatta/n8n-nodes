import type { ICredentialType, INodeProperties } from "n8n-workflow";

export class RestateApi implements ICredentialType {
  name = "restateApi";

  displayName = "Restate API";

  documentationUrl = "https://docs.restate.dev/invoke/http";

  properties: INodeProperties[] = [
    {
      displayName: "Ingress Base URL",
      name: "baseUrl",
      type: "string",
      default: "http://127.0.0.1:8080",
      placeholder: "http://127.0.0.1:8080",
      required: true,
      description:
        "Restate HTTP ingress URL. Use the internal WireGuard URL for private n8n-to-Restate calls.",
    },
    {
      displayName: "Bearer Token",
      name: "bearerToken",
      type: "string",
      typeOptions: { password: true },
      default: "",
      description:
        "Optional bearer token for an authenticated Restate ingress proxy. Leave empty for private internal ingress.",
    },
  ];
}
