import { unescape } from "jsr:@std/html@^1.0.7";
import {
  escapeForEmbed,
  type Middleware,
} from "../deps/scrapbox_url_customizer.ts";
import { type Fetcher, getDefaultFetcher } from "../bluesky/fetch_post.ts";
import {
  type FediverseMedia,
  formatFediverseMedia,
  type FormatFediverseMediaOptions,
} from "./media.ts";

export interface MastodonPostReference {
  id: string;
  canonicalURL: URL;
}

export interface MastodonAccount {
  acct: string;
}

export interface MastodonMediaAttachment {
  type: "image" | "gifv" | "video" | "audio" | "unknown";
  url: string | null;
  description?: string | null;
}

export interface MastodonStatus {
  id: string;
  content: string;
  spoiler_text: string;
  account: MastodonAccount;
  media_attachments: MastodonMediaAttachment[];
  reblog?: MastodonStatus | null;
  url?: string | null;
}

export const parseMastodonPostURL = (
  url: Readonly<URL>,
): MastodonPostReference | undefined => {
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  const match = url.pathname.match(
    /^(?:\/@[^/]+\/|\/users\/[^/]+\/statuses\/|\/web\/statuses\/)(\d+)\/?$/,
  );
  if (!match) return undefined;
  const canonicalURL = new URL(url);
  canonicalURL.search = "";
  canonicalURL.hash = "";
  canonicalURL.pathname = canonicalURL.pathname.replace(/\/$/, "");
  return { id: match[1], canonicalURL };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object";

const validateMastodonStatus = (candidate: unknown): MastodonStatus => {
  if (!isRecord(candidate) || !isRecord(candidate.account)) {
    throw new TypeError("Mastodon returned an invalid status");
  }
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.content !== "string" ||
    typeof candidate.spoiler_text !== "string" ||
    typeof candidate.account.acct !== "string" ||
    !Array.isArray(candidate.media_attachments)
  ) {
    throw new TypeError("Mastodon returned an invalid status");
  }
  return candidate as unknown as MastodonStatus;
};

export const fetchMastodonStatus = async (
  reference: MastodonPostReference,
  fetcher: Fetcher = getDefaultFetcher(),
): Promise<MastodonStatus> => {
  const endpoint = new URL(
    `/api/v1/statuses/${encodeURIComponent(reference.id)}`,
    reference.canonicalURL.origin,
  );
  const response = await fetcher(endpoint, { credentials: "omit" });
  if (!response.ok) {
    throw new Error(
      `Mastodon status request failed: ${response.status} ${response.statusText}`,
    );
  }
  return validateMastodonStatus(await response.json());
};

const attribute = (tag: string, name: string): string | undefined => {
  const match = tag.match(
    new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"),
  );
  return match ? unescape(match[1] ?? match[2] ?? match[3] ?? "") : undefined;
};

const plainAnchorLabel = (html: string): string =>
  unescape(
    html
      .replace(
        /<span\b[^>]*class\s*=\s*["'][^"']*\binvisible\b[^"']*["'][^>]*>[\s\S]*?<\/span>/gi,
        "",
      )
      .replace(/<[^>]+>/g, ""),
  ).trim();

const escapePlainText = (value: string): string =>
  value.split(/(\s+)/).map((part) =>
    /^\s+$/.test(part) ? part : escapeForEmbed(part)
  ).join("");

/** Converts Mastodon's sanitized status HTML to Cosense-friendly text. */
export const renderMastodonHTML = (
  html: string,
  baseURL: Readonly<URL>,
): string => {
  const embeds: string[] = [];
  const withTokens = html
    .replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, (anchor) => {
      const openTag = anchor.match(/^<a\b[^>]*>/i)?.[0] ?? "";
      const href = attribute(openTag, "href");
      const label = plainAnchorLabel(
        anchor.slice(openTag.length).replace(/<\/a>$/i, ""),
      );
      let rendered = escapeForEmbed(label);
      if (href) {
        try {
          const url = new URL(href, baseURL);
          if (url.protocol === "https:" || url.protocol === "http:") {
            rendered = label.startsWith("#")
              ? escapeForEmbed(label)
              : label.startsWith("@")
              ? `[${escapeForEmbed(label)} ${url.href}]`
              : label && !/^https?:\/\//i.test(label)
              ? `[${escapeForEmbed(label)} ${url.href}]`
              : url.href;
          }
        } catch (_error) {
          // Keep the visible label for malformed links.
        }
      }
      const index = embeds.push(rendered) - 1;
      return `\uE000${index}\uE001`;
    })
    .replace(/<img\b[^>]*>/gi, (tag) => attribute(tag, "alt") ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|blockquote|h[1-6])\s*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "");

  return unescape(withTokens)
    .split(/(\uE000\d+\uE001)/)
    .map((part) => {
      const match = part.match(/^\uE000(\d+)\uE001$/);
      return match ? embeds[Number(match[1])] : escapePlainText(part);
    })
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const authorHandle = (status: MastodonStatus, url: Readonly<URL>): string =>
  status.account.acct.includes("@")
    ? status.account.acct
    : `${status.account.acct}@${url.hostname}`;

const mediaFromStatus = (status: MastodonStatus): FediverseMedia[] =>
  status.media_attachments.flatMap((attachment) => {
    if (typeof attachment.url !== "string") return [];
    try {
      return [
        {
          type: attachment.type === "gifv" ? "video" : attachment.type,
          url: new URL(attachment.url),
          ...(attachment.description
            ? { description: attachment.description }
            : {}),
        } satisfies FediverseMedia,
      ];
    } catch (_error) {
      return [];
    }
  });

export interface FormatMastodonPostOptions extends FormatFediverseMediaOptions {
  fetcher?: Fetcher;
}

export const stringifyMastodonStatus = async (
  status: MastodonStatus,
  postURL: Readonly<URL>,
  options: FormatFediverseMediaOptions = {},
): Promise<string> => {
  const lines = [
    `[@${escapeForEmbed(authorHandle(status, postURL))} ${postURL.href}]`,
  ];
  if (status.spoiler_text) {
    lines.push(`CW: ${escapeForEmbed(status.spoiler_text)}`);
  }
  const body = renderMastodonHTML(status.content, postURL);
  if (body) lines.push(...body.split("\n"));

  if (status.reblog) {
    const reblogURL = status.reblog.url;
    if (typeof reblogURL === "string") lines.push(`Boost: ${reblogURL}`);
  } else {
    lines.push(
      ...await formatFediverseMedia(
        mediaFromStatus(status),
        postURL,
        options,
      ),
    );
  }

  while (lines.at(-1)?.trim() === "") lines.pop();
  return lines.map((line) => `> ${line}`).join("\n");
};

export const formatMastodonPost = (
  options: FormatMastodonPostOptions = {},
): Middleware =>
(url) => {
  const reference = parseMastodonPostURL(url);
  if (!reference) return new URL(url);
  return fetchMastodonStatus(reference, options.fetcher).then((status) =>
    stringifyMastodonStatus(status, reference.canonicalURL, options)
  );
};
