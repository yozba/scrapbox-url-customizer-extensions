import { unescape } from "jsr:@std/html@^1.0.7";
import type { ProcessedTweet, Tweet } from "../deps/scrapbox_url_customizer.ts";

type RawTweet = Tweet | NonNullable<Tweet["parent"]>;

/**
 * Converts the public syndication response into the processed form expected by
 * the upstream stringifier. Kept local because the upstream helper is internal.
 * Derived from takker99/scrapbox-url-customizer (MIT).
 */
export const processTweet = (tweet: RawTweet): ProcessedTweet => {
  const entities = [
    ...tweet.entities.hashtags?.map((hashtag) => ({
      type: "hashtag" as const,
      ...hashtag,
    })) ?? [],
    ...tweet.entities.symbols?.map((symbol) => ({
      type: "symbol" as const,
      ...symbol,
    })) ?? [],
    ...tweet.entities.user_mentions?.map((mention) => ({
      type: "mention" as const,
      name: mention.name,
      screenName: mention.screen_name,
      indices: mention.indices,
    })) ?? [],
    ...tweet.entities.urls?.map((url) => ({
      type: "url" as const,
      indices: url.indices,
      url: new URL(url.expanded_url),
    })) ?? [],
    ...tweet.entities.media?.map((media) => ({
      type: "media" as const,
      indices: media.indices,
      media: tweet.mediaDetails?.flatMap((detail) =>
        detail.url === media.url
          ? [{
            type: detail.type,
            url: new URL(
              detail.video_info?.variants?.sort((a, b) =>
                (b.bitrate ?? 0) - (a.bitrate ?? 0)
              )[0]?.url ?? detail.media_url_https,
            ),
          }]
          : []
      ) ?? [],
    })) ?? [],
  ].sort((a, b) => a.indices[0] - b.indices[0]);

  const content: ProcessedTweet["content"] = [];
  let offset = 0;
  let text = tweet.text;
  for (const { indices, ...entity } of entities) {
    const before = [...text].slice(0, indices[0] - offset).join("");
    content.push({ type: "plain", text: unescape(before) });
    content.push(entity);
    text = [...text].slice(indices[1] - offset).join("");
    offset = indices[1];
  }
  if (text) content.push({ type: "plain", text: unescape(text) });

  const processed: ProcessedTweet = {
    id: tweet.id_str,
    content,
    author: {
      name: tweet.user.name,
      screenName: tweet.user.screen_name,
    },
    posted: new Date(tweet.created_at),
    replyCount: "reply_count" in tweet
      ? tweet.reply_count
      : tweet.conversation_count,
  };
  if (tweet.self_thread) processed.rootId = tweet.self_thread.id_str;
  if (tweet.in_reply_to_status_id_str) {
    processed.replyId = tweet.in_reply_to_status_id_str;
  }
  if (tweet.parent) processed.replyTo = processTweet(tweet.parent);
  if (tweet.quoted_tweet) processed.quote = processTweet(tweet.quoted_tweet);
  return processed;
};
