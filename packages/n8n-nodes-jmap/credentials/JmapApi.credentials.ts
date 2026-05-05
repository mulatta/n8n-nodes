import type { ICredentialType, INodeProperties, Icon } from "n8n-workflow";

export class JmapApi implements ICredentialType {
  name = "jmapApi";

  displayName = "JMAP API";

  documentationUrl = "jmap";

  icon: Icon = "file:../nodes/Jmap/jmap.svg";

  properties: INodeProperties[] = [
    {
      displayName: "Session URL",
      name: "sessionUrl",
      type: "string",
      default: "",
      placeholder: "https://mail.example.com/.well-known/jmap",
      required: true,
      description: "JMAP session endpoint URL",
    },
    {
      displayName: "Username",
      name: "username",
      type: "string",
      default: "",
      required: true,
    },
    {
      displayName: "Password",
      name: "password",
      type: "string",
      typeOptions: { password: true },
      default: "",
      required: true,
    },
    {
      displayName: "Public Origin Rewrite",
      name: "publicOrigin",
      type: "string",
      default: "",
      placeholder: "https://mail.example.com",
      description:
        "Optional public origin used when a server returns internal apiUrl/uploadUrl values",
    },
  ];
}
