# IMAP

Interact with an IMAP mailbox. This node uses only Node.js built-in `tls` and
`net` modules for the IMAP protocol.

## Operations

- **Create Draft** — build a MIME email, including JSON or binary attachments,
  and append it to the drafts mailbox with the `\\Draft` flag.
- **Append** — append a raw RFC 2822 email from JSON or binary data.
- **Move** — move a message by UID, using MOVE when available and COPY + DELETE
  - EXPUNGE as fallback.
- **List** — list mailbox folders.

## Create Draft attachments

Attachments can come from:

- **JSON**: an array of `{ filename, data, contentType }` objects, where `data`
  is base64-encoded.
- **Binary Properties**: comma-separated n8n binary property names.
- **All Binary Data**: all binary properties on the current input item.
