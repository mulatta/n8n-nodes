# yt-dlp

Download media with [yt-dlp](https://github.com/yt-dlp/yt-dlp) from n8n.

This node is intentionally only the download/metadata step. Collect URLs,
upload to storage, and delete local spool files in separate workflow steps.

## Operations

- **Get Info**: runs `yt-dlp --dump-single-json --no-download` and returns
  metadata.
- **Download**: gets metadata, downloads the media, and returns metadata plus a
  local file path or binary data.

## Authentication

Authentication is optional. For sites that need login, choose **Cookie File**
and attach a **yt-dlp Cookie File** credential. The credential stores only a
path to a Netscape-format cookie file, so a separate systemd timer or workflow
can refresh the cookie file atomically.

Recommended path:

```text
/var/lib/n8n/.local/state/n8n-nodes-ytdlp/cookies/x.netscape.txt
```

Use mode `0600` and owner `n8n:n8n` for the cookie file.

## Storage workflow

For Nextcloud/WebDAV, prefer a local spool followed by upload and deletion:

```text
URL collector -> yt-dlp Download -> Nextcloud/WebDAV upload -> Delete local file
```

Default spool directory:

```text
/var/lib/n8n/.cache/n8n-nodes-ytdlp/downloads
```

Keep the download archive in persistent state, not the cache directory.

```text
/var/lib/n8n/.local/state/n8n-nodes-ytdlp/downloaded.txt
```

## Runtime

The node runs the executable from **yt-dlp Path**, `$YT_DLP_PATH`, or `yt-dlp`
on `PATH`, in that order. On NixOS, this flake's module sets `YT_DLP_PATH` and
adds `yt-dlp`/`ffmpeg` to the n8n service path when the node is enabled.
