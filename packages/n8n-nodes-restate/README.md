# Restate

Invoke [Restate](https://restate.dev/) handlers from n8n through HTTP ingress.

## Operations

- **Call**: `POST /<invocation-path>` and wait for the handler response.
- **Send**: `POST /<invocation-path>/send` and return Restate's invocation ID.

The node accepts a generic invocation path, so workload schemas stay in the
Restate service. Examples:

- `xLikedMedia/bootstrap`
- `xLikedMedia/status`
- `WorkflowName/workflow-id/run`
- `VirtualObject/key/handler`

## Credentials

Create a **Restate API** credential with the private ingress URL, for example:

```text
http://[wireguard-address]:8081
```

Leave **Bearer Token** empty for private internal ingress. Set it only when a
reverse proxy protects the Restate ingress with bearer auth.

## Idempotency

Set **Idempotency Key** for retried n8n executions. Restate deduplicates calls
with the same key within its configured retention window.
