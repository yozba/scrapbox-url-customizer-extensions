import { type Fetcher, getDefaultFetcher } from "../bluesky/fetch_post.ts";
import type {
  InstagramMediaItem,
  InstagramOEmbed,
  InstagramPost,
  InstagramPostReference,
} from "./types.ts";

const INSTAGRAM_APP_ID = "936619743392459";

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
  fetcher: Fetcher = getDefaultFetcher(),
): Promise<InstagramMediaItem | undefined> => {
  const url = new URL(
    `/api/v1/media/${encodeURIComponent(mediaId)}/info/`,
    "https://www.instagram.com",
  );
  const response = await fetcher(url, {
    credentials: "include",
    headers: {
      "X-IG-App-ID": INSTAGRAM_APP_ID,
      "X-ASBD-ID": "129477",
      "X-Requested-With": "XMLHttpRequest",
      Referer: postURL.href,
    },
    referrer: postURL.href,
  });
  if ([401, 403, 404].includes(response.status)) {
    console.info(
      `Instagram authenticated media is unavailable (${response.status}); using oEmbed.`,
    );
    return undefined;
  }
  if (!response.ok) {
    throw new Error(
      `Instagram media request failed: ${response.status} ${response.statusText}`,
    );
  }
  const result = await response.json() as { items?: unknown };
  if (!Array.isArray(result.items) || result.items.length === 0) {
    return undefined;
  }
  const item = result.items[0];
  return item !== null && typeof item === "object"
    ? item as InstagramMediaItem
    : undefined;
};

export interface FetchInstagramPostOptions {
  fetcher?: Fetcher;
  authenticated?: boolean;
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
      fetcher,
    );
  return { reference, oembed, authenticated };
};
