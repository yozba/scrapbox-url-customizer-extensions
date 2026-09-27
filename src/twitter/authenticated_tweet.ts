import {
  formatTweet,
  type Middleware,
  type ProcessedTweet,
  stringify,
  type Tweet,
} from "jsr:@takker/scrapbox-url-customizer@^0.4.8";
import { formatRootTweet, normalizeTweetOutput } from "./format_tweet.ts";
import { processTweet } from "./process_tweet.ts";

export interface XPostReference {
  id: string;
  canonicalURL: URL;
}

export type AuthenticatedTweetGetter = (id: string) => Promise<unknown>;

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
      "Authenticated Media Bridge is not installed or has not loaded",
    );
  }
  return processAuthenticatedTweetResult(await getter(id), id);
};

export const stringifyAuthenticatedTweet = async (
  tweet: ProcessedTweet,
): Promise<string> => {
  const rendered = normalizeTweetOutput(await stringify(tweet));
  return rendered.split("\n").map((line) => `> ${line}`).join("\n");
};

export interface FormatAuthenticatedTweetOptions {
  getTweet?: AuthenticatedTweetGetter;
  publicMiddleware?: Middleware;
}

/** Tries the no-login formatter first, then the browser's X session. */
export const formatAuthenticatedTweet = (
  options: FormatAuthenticatedTweetOptions = {},
): Middleware => {
  const publicMiddleware = options.publicMiddleware ??
    formatTweet(formatRootTweet);

  return (url) => {
    const reference = parseXPostURL(url);
    if (!reference) return new URL(url);

    const publicResult = publicMiddleware(url);
    if (publicResult instanceof URL) return publicResult;

    return Promise.resolve(publicResult).catch(async (publicError) => {
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
        throw new AggregateError(
          [publicError, authenticatedError],
          "Public and authenticated X post expansion both failed",
        );
      }
    });
  };
};
