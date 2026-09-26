import type { BlueskyPost, BlueskyPostReference } from "./types.ts";

const APP_VIEW_ORIGIN = "https://public.api.bsky.app";

export type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export const getDefaultFetcher = (): Fetcher => {
  const globalWithGMFetch = globalThis as typeof globalThis & {
    GM_fetch?: Fetcher;
  };
  return globalWithGMFetch.GM_fetch ?? globalThis.fetch.bind(globalThis);
};

const getJSON = async <T>(url: URL, fetcher: Fetcher): Promise<T> => {
  const response = await fetcher(url);
  if (!response.ok) {
    throw new Error(
      `Bluesky API request failed: ${response.status} ${response.statusText}`,
    );
  }
  return await response.json() as T;
};

/** Extracts the actor and record key from a bsky.app post URL. */
export const parseBlueskyPostURL = (
  url: Readonly<URL>,
): BlueskyPostReference | undefined => {
  if (url.hostname !== "bsky.app" && url.hostname !== "www.bsky.app") {
    return undefined;
  }

  const match = url.pathname.match(/^\/profile\/([^/]+)\/post\/([^/]+)\/?$/);
  if (!match) return undefined;

  try {
    return {
      actor: decodeURIComponent(match[1]),
      rkey: decodeURIComponent(match[2]),
    };
  } catch (_error) {
    return undefined;
  }
};

/** Resolves a Bluesky handle to a DID. A DID in the URL is returned as-is. */
export const resolveBlueskyActor = async (
  actor: string,
  fetcher: Fetcher = getDefaultFetcher(),
): Promise<string> => {
  if (actor.startsWith("did:")) return actor;

  const url = new URL(
    "/xrpc/com.atproto.identity.resolveHandle",
    APP_VIEW_ORIGIN,
  );
  url.searchParams.set("handle", actor);
  const result = await getJSON<{ did?: unknown }>(url, fetcher);
  if (typeof result.did !== "string" || !result.did.startsWith("did:")) {
    throw new TypeError("Bluesky resolveHandle returned an invalid DID");
  }
  return result.did;
};

/** Fetches one hydrated post without fetching its parent, replies, or quote. */
export const fetchBlueskyPost = async (
  reference: BlueskyPostReference,
  fetcher: Fetcher = getDefaultFetcher(),
): Promise<BlueskyPost> => {
  const did = await resolveBlueskyActor(reference.actor, fetcher);
  const atURI = `at://${did}/app.bsky.feed.post/${reference.rkey}`;
  const url = new URL("/xrpc/app.bsky.feed.getPosts", APP_VIEW_ORIGIN);
  url.searchParams.append("uris", atURI);

  const result = await getJSON<{ posts?: unknown }>(url, fetcher);
  if (!Array.isArray(result.posts) || result.posts.length === 0) {
    throw new Error(`Bluesky post was not found: ${atURI}`);
  }

  const candidate = result.posts[0];
  if (candidate === null || typeof candidate !== "object") {
    throw new TypeError("Bluesky getPosts returned an invalid post");
  }
  const post = candidate as Partial<BlueskyPost>;
  if (
    typeof post.uri !== "string" || typeof post.cid !== "string" ||
    typeof post.author?.did !== "string" ||
    typeof post.author?.handle !== "string" ||
    typeof post.record?.text !== "string"
  ) {
    throw new TypeError("Bluesky getPosts returned an invalid post");
  }
  return post as BlueskyPost;
};
