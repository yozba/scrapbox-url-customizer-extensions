import type {
  Middleware,
  ProcessedTweet,
  Tweet,
  TweetViaProxy,
} from "../deps/scrapbox_url_customizer.ts";
import { getTweetInfo } from "../deps/cosense_std.ts";
import { type Fetcher, getDefaultFetcher } from "../bluesky/fetch_post.ts";
import {
  formatRootTweet,
  normalizeTweetOutput,
  stringifyRootTweet,
} from "./format_tweet.ts";
import { processTweet } from "./process_tweet.ts";

export interface XPostReference {
  id: string;
  canonicalURL: URL;
}

export type AuthenticatedTweetGetter = (id: string) => Promise<unknown>;

/** Detects the successful-looking placeholder returned for logged-out media. */
export const isXLoginRequiredPlaceholder = (text: string): boolean => {
  const normalized = text.replace(/[\u2018\u2019]/g, "'").toLowerCase();
  return normalized.includes("age-restricted adult content") &&
    (normalized.includes("not be appropriate for people under 18") ||
      normalized.includes("you'll need to log in to x"));
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

const getDefaultAuthenticatedTweetGetter = () =>
  (globalThis as typeof globalThis & {
    GM_X_getTweet?: AuthenticatedTweetGetter;
  }).GM_X_getTweet;

interface XEntitySet {
  hashtags?: unknown[];
  symbols?: unknown[];
  user_mentions?: unknown[];
  urls?: unknown[];
  media?: unknown[];
}

interface XGraphQLTweet {
  __typename?: string;
  rest_id?: string;
  tweet?: XGraphQLTweet;
  reason?: string;
  legacy?: {
    created_at?: string;
    full_text?: string;
    text?: string;
    reply_count?: number;
    conversation_id_str?: string;
    in_reply_to_status_id_str?: string | null;
    entities?: XEntitySet;
    extended_entities?: { media?: unknown[] };
  };
  core?: {
    user_results?: { result?: XGraphQLUser };
    user_result?: { result?: XGraphQLUser };
  };
  note_tweet?: {
    note_tweet_results?: {
      result?: { text?: string; entity_set?: XEntitySet };
    };
  };
}

interface XGraphQLUser {
  legacy?: { name?: string; screen_name?: string };
  core?: { name?: string; screen_name?: string };
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object"
    ? value as Record<string, unknown>
    : undefined;

export const parseXPostURL = (
  url: Readonly<URL>,
): XPostReference | undefined => {
  if (!/^(?:(?:www|mobile|m)\.)?(?:twitter|x)\.com$/i.test(url.hostname)) {
    return undefined;
  }
  const match = url.pathname.match(
    /^\/([A-Za-z0-9_]+)\/(?:status|statuses)\/(\d+)/,
  );
  if (!match) return undefined;
  return {
    id: match[2],
    canonicalURL: new URL(`https://x.com/${match[1]}/status/${match[2]}`),
  };
};

const unwrapTweet = (value: unknown): XGraphQLTweet | undefined => {
  const root = asRecord(value);
  const data = asRecord(root?.data) ?? root;
  const tweetResult = asRecord(data?.tweetResult) ??
    asRecord(data?.tweet_result);
  let result = (tweetResult?.result ?? tweetResult ?? value) as
    | XGraphQLTweet
    | undefined;
  for (let depth = 0; depth < 3 && result?.tweet; depth++) {
    result = result.tweet;
  }
  return result;
};

/** Converts X Web's authenticated GraphQL result into the upstream Tweet form. */
export const processAuthenticatedTweetResult = (
  payload: unknown,
  expectedId?: string,
): ProcessedTweet => {
  const tweet = unwrapTweet(payload);
  const legacy = tweet?.legacy;
  const user = tweet?.core?.user_results?.result ??
    tweet?.core?.user_result?.result;
  const userLegacy = user?.legacy ?? user?.core;
  const note = tweet?.note_tweet?.note_tweet_results?.result;
  const id = tweet?.rest_id ?? expectedId;
  const text = note?.text ?? legacy?.full_text ?? legacy?.text;
  const screenName = userLegacy?.screen_name;

  if (!tweet || !legacy || !id || !text || !screenName) {
    const reason = tweet?.reason ? `: ${tweet.reason}` : "";
    throw new TypeError(`X returned an unavailable tweet${reason}`);
  }

  const noteEntities = note?.entity_set;
  const legacyEntities = legacy.entities ?? {};
  const entities = noteEntities
    ? { ...legacyEntities, ...noteEntities, media: legacyEntities.media }
    : legacyEntities;

  const rawTweet = {
    id_str: id,
    text,
    user: {
      name: userLegacy?.name ?? screenName,
      screen_name: screenName,
    },
    created_at: legacy.created_at ?? new Date().toISOString(),
    reply_count: legacy.reply_count ?? 0,
    conversation_count: legacy.reply_count ?? 0,
    in_reply_to_status_id_str: legacy.in_reply_to_status_id_str ?? undefined,
    entities,
    mediaDetails: legacy.extended_entities?.media ?? [],
  } as unknown as Tweet;

  const { quote: _quote, replyTo: _replyTo, ...root } = processTweet(rawTweet);
  return root;
};

export const fetchAuthenticatedTweet = async (
  id: string,
  getter: AuthenticatedTweetGetter | undefined =
    getDefaultAuthenticatedTweetGetter(),
): Promise<ProcessedTweet> => {
  if (!getter) {
    throw new Error(
      "X Auth Bridge is not installed or has not loaded",
    );
  }
  return processAuthenticatedTweetResult(await getter(id), id);
};

export const stringifyAuthenticatedTweet = async (
  tweet: ProcessedTweet,
): Promise<string> => {
  const rendered = normalizeTweetOutput(await stringifyRootTweet(tweet));
  return rendered.split("\n").map((line) => `> ${line}`).join("\n");
};

const formatPublicTweet = async (
  reference: XPostReference,
  fetcher: Fetcher,
): Promise<string> => {
  let syndicationError: unknown;
  try {
    const url = new URL("https://cdn.syndication.twimg.com/tweet-result");
    url.searchParams.set("id", reference.id);
    url.searchParams.set("token", "x");
    const response = await fetcher(url, { credentials: "omit" });
    if (!response.ok) {
      throw new Error(
        `X syndication request failed: ${response.status} ${response.statusText}`,
      );
    }
    return await formatRootTweet(
      await response.json() as Tweet,
      reference.canonicalURL,
    );
  } catch (error) {
    syndicationError = error;
  }

  const proxy = await getTweetInfo(reference.canonicalURL.href);
  if (!proxy.ok) {
    throw new AggregateError(
      [syndicationError, proxy.err],
      "Public X post expansion failed",
    );
  }
  return await formatRootTweet({
    ...proxy.val as TweetViaProxy,
    id: reference.id,
  }, reference.canonicalURL);
};

export interface FormatAuthenticatedTweetOptions {
  getTweet?: AuthenticatedTweetGetter;
  publicMiddleware?: Middleware;
  fetcher?: Fetcher;
}

/** Tries the no-login formatter first, then the browser's X session. */
export const formatAuthenticatedTweet = (
  options: FormatAuthenticatedTweetOptions = {},
): Middleware => {
  return (url) => {
    const reference = parseXPostURL(url);
    if (!reference) return new URL(url);

    const publicResult = options.publicMiddleware
      ? options.publicMiddleware(url)
      : formatPublicTweet(reference, options.fetcher ?? getDefaultFetcher());
    if (publicResult instanceof URL) return publicResult;

    return Promise.resolve(publicResult).then((result) => {
      if (
        typeof result === "string" && isXLoginRequiredPlaceholder(result)
      ) {
        throw new Error(
          "Public X API returned an age-restricted login placeholder",
        );
      }
      return result;
    }).catch(async (publicError) => {
      console.info(
        "Public X expansion failed; trying the logged-in X session.",
        publicError,
      );
      try {
        const tweet = await fetchAuthenticatedTweet(
          reference.id,
          options.getTweet ?? getDefaultAuthenticatedTweetGetter(),
        );
        return await stringifyAuthenticatedTweet(tweet);
      } catch (authenticatedError) {
        console.error(
          "Logged-in X expansion failed.",
          authenticatedError,
        );
        throw new AggregateError(
          [publicError, authenticatedError],
          `Public and authenticated X post expansion both failed: ${
            errorMessage(authenticatedError)
          }`,
        );
      }
    });
  };
};
