import { type Fetcher, getDefaultFetcher } from "../bluesky/fetch_post.ts";
import type {
  InstagramMediaItem,
  InstagramOEmbed,
  InstagramPost,
  InstagramPostReference,
} from "./types.ts";

export type AuthenticatedInstagramMediaGetter = (
  mediaId: string,
  postURL: string,
) => Promise<unknown>;

const getDefaultAuthenticatedMediaGetter = () =>
  (globalThis as typeof globalThis & {
    GM_Instagram_getMedia?: AuthenticatedInstagramMediaGetter;
  }).GM_Instagram_getMedia;

export const parseInstagramPostURL = (
  url: Readonly<URL>,
): InstagramPostReference | undefined => {
  const hostname = url.hostname.toLowerCase();
  if (
    hostname !== "instagram.com" && hostname !== "www.instagram.com" &&
    hostname !== "instagr.am" && hostname !== "www.instagr.am"
  ) {
    return undefined;
  }
  const match = url.pathname.match(/^\/(p|reel|reels|tv)\/([^/]+)\/?$/i);
  if (!match) return undefined;
  let shortcode: string;
  try {
    shortcode = decodeURIComponent(match[2]);
  } catch (_error) {
    return undefined;
  }
  if (!/^[A-Za-z0-9_-]+$/.test(shortcode)) return undefined;
  return {
    shortcode,
    canonicalURL: new URL(
      `https://www.instagram.com/${match[1].toLowerCase()}/${shortcode}/`,
    ),
  };
};

export const fetchInstagramOEmbed = async (
  reference: InstagramPostReference,
  fetcher: Fetcher = getDefaultFetcher(),
): Promise<InstagramOEmbed> => {
  const url = new URL("https://www.instagram.com/api/v1/oembed/");
  url.searchParams.set("url", reference.canonicalURL.href);
  const response = await fetcher(url, { credentials: "omit" });
  if (!response.ok) {
    throw new Error(
      `Instagram oEmbed request failed: ${response.status} ${response.statusText}`,
    );
  }
  const result = await response.json() as Partial<InstagramOEmbed>;
  if (typeof result.media_id !== "string") {
    throw new TypeError("Instagram oEmbed returned an invalid media ID");
  }
  return result as InstagramOEmbed;
};

export const fetchAuthenticatedInstagramMedia = async (
  mediaId: string,
  postURL: Readonly<URL>,
  getter: AuthenticatedInstagramMediaGetter | undefined =
    getDefaultAuthenticatedMediaGetter(),
): Promise<InstagramMediaItem | undefined> => {
  if (!getter) {
    console.info(
      "Instagram Auth Bridge is not installed; using oEmbed.",
    );
    return undefined;
  }
  const item = await getter(mediaId, postURL.href);
  return item !== null && typeof item === "object"
    ? item as InstagramMediaItem
    : undefined;
};

export interface FetchInstagramPostOptions {
  fetcher?: Fetcher;
  authenticated?: boolean;
  getAuthenticatedMedia?: AuthenticatedInstagramMediaGetter;
}

export const fetchInstagramPost = async (
  reference: InstagramPostReference,
  options: FetchInstagramPostOptions = {},
): Promise<InstagramPost> => {
  const fetcher = options.fetcher ?? getDefaultFetcher();
  const oembed = await fetchInstagramOEmbed(reference, fetcher);
  const authenticated = options.authenticated === false
    ? undefined
    : await fetchAuthenticatedInstagramMedia(
      oembed.media_id,
      reference.canonicalURL,
      options.getAuthenticatedMedia ?? getDefaultAuthenticatedMediaGetter(),
    );
  return { reference, oembed, authenticated };
};
