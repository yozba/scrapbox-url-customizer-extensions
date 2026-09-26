import {
  escapeForEmbed,
  type Middleware,
} from "jsr:@takker/scrapbox-url-customizer@^0.4.8";
import {
  fetchBlueskyPost,
  type Fetcher,
  parseBlueskyPostURL,
} from "./fetch_post.ts";
import type {
  BlueskyEmbedView,
  BlueskyFacet,
  BlueskyFacetFeature,
  BlueskyImageView,
  BlueskyPost,
} from "./types.ts";
import {
  type BlueskyImageUploader,
  uploadBlueskyImage,
} from "./upload_image.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const formatFacet = (
  source: string,
  features: BlueskyFacetFeature[],
): string => {
  const link = features.find((feature) =>
    feature.$type === "app.bsky.richtext.facet#link" &&
    typeof feature.uri === "string"
  );
  if (link?.uri) return link.uri;

  const mention = features.find((feature) =>
    feature.$type === "app.bsky.richtext.facet#mention" &&
    typeof feature.did === "string"
  );
  if (mention?.did) {
    const label = escapeForEmbed(source.replace(/^@/, ""));
    return `[@${label} https://bsky.app/profile/${mention.did}]`;
  }

  const tag = features.find((feature) =>
    feature.$type === "app.bsky.richtext.facet#tag" &&
    typeof feature.tag === "string"
  );
  if (tag?.tag) return ` #${escapeForEmbed(tag.tag)} `;

  return source;
};

/** Renders Bluesky rich-text facets using UTF-8 byte offsets. */
export const renderBlueskyText = (
  text: string,
  facets: BlueskyFacet[] = [],
): string => {
  const bytes = encoder.encode(text);
  const sorted = [...facets].sort((a, b) =>
    a.index.byteStart - b.index.byteStart
  );
  const fragments: string[] = [];
  let offset = 0;

  for (const facet of sorted) {
    const { byteStart, byteEnd } = facet.index;
    if (
      !Number.isInteger(byteStart) || !Number.isInteger(byteEnd) ||
      byteStart < offset || byteEnd <= byteStart || byteEnd > bytes.length
    ) {
      continue;
    }
    fragments.push(decoder.decode(bytes.slice(offset, byteStart)));
    const source = decoder.decode(bytes.slice(byteStart, byteEnd));
    fragments.push(formatFacet(source, facet.features));
    offset = byteEnd;
  }

  fragments.push(decoder.decode(bytes.slice(offset)));
  return fragments.join("");
};

/** Returns only images attached to the requested post, never quoted-post media. */
export const extractBlueskyImages = (
  embed: BlueskyEmbedView | undefined,
): BlueskyImageView[] => {
  if (!embed) return [];
  if (Array.isArray(embed.images)) {
    return embed.images.filter((image) => typeof image.fullsize === "string");
  }
  // recordWithMedia stores the post's own media here. `record` is the quote.
  if (embed.media) return extractBlueskyImages(embed.media);
  return [];
};

const getExternal = (
  embed: BlueskyEmbedView | undefined,
): BlueskyEmbedView["external"] => {
  if (!embed) return undefined;
  if (embed.external?.uri) return embed.external;
  return embed.media ? getExternal(embed.media) : undefined;
};

const sourcePostURL = (url: Readonly<URL>): string => {
  const clean = new URL(url);
  clean.search = "";
  clean.hash = "";
  return clean.href.replace(/\/$/, "");
};

const asCosenseImageURL = (value: string): string => {
  const url = new URL(value);
  if (/(?:^|\.)gyazo\.com$/i.test(url.hostname)) return url.href;
  if (
    !/(?:\.(?:avif|gif|jpe?g|png|svg|webp)|@(?:avif|gif|jpe?g|png|webp))$/i
      .test(url.pathname) && !url.hash
  ) {
    // The fragment is not sent to the CDN. It only supplies a file-type hint
    // when Bluesky returns an image URL without an extension.
    url.hash = ".jpg";
  }
  return url.href;
};

/** Converts one Bluesky post to Cosense notation. */
export const stringifyBlueskyPost = async (
  post: BlueskyPost,
  url: Readonly<URL>,
  uploadImage: BlueskyImageUploader = uploadBlueskyImage,
): Promise<string> => {
  const lines = [
    `[@${escapeForEmbed(post.author.handle)} ${sourcePostURL(url)}]`,
  ];
  const body = renderBlueskyText(post.record.text, post.record.facets);
  if (body) lines.push(...body.split("\n"));

  const images = extractBlueskyImages(post.embed);
  if (images.length > 0) {
    // Cosense image notation. Keep every image on one line with no spaces.
    const uploaded = await Promise.all(
      images.map((image) => uploadImage(image, url)),
    );
    lines.push(
      uploaded.map((image) => `[${asCosenseImageURL(image.href)}]`).join(""),
    );
  }

  const external = getExternal(post.embed);
  if (external && !body.includes(external.uri)) {
    const title = external.title ? escapeForEmbed(external.title) : "";
    lines.push(title ? `[${title} ${external.uri}]` : external.uri);
  }

  while (lines.at(-1)?.trim() === "") lines.pop();
  return lines.map((line) => `> ${line}`).join("\n");
};

export interface FormatBlueskyPostOptions {
  fetcher?: Fetcher;
  uploadImage?: BlueskyImageUploader;
}

/** Creates a middleware that expands bsky.app post URLs. */
export const formatBlueskyPost = (
  options: FormatBlueskyPostOptions = {},
): Middleware =>
(url) => {
  const reference = parseBlueskyPostURL(url);
  if (!reference) return new URL(url);
  return fetchBlueskyPost(reference, options.fetcher).then((post) =>
    stringifyBlueskyPost(post, url, options.uploadImage)
  );
};
