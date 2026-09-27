import {
  convertScrapboxURL,
  escapeForEmbed,
  type Media,
  type ProcessedTweet,
  type Tweet,
  type TweetFormatter,
  type TweetViaProxy,
} from "../deps/scrapbox_url_customizer.ts";
import { processTweet } from "./process_tweet.ts";
import { uploadXMedia, type XMediaUploader } from "./upload_media.ts";

const imageLine = /^(?:\[https?:\/\/[^\]\r\n]+\])+$/;
const paddedTag = / (#\$?[^\s]+) /g;

/** Removes the upstream trailing blank line and compacts image rows. */
export const normalizeTweetOutput = (text: string): string => {
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  while (lines.at(-1)?.trim() === "") lines.pop();

  const compacted: string[] = [];
  for (const line of lines) {
    const match = line.match(/^(\s*>\s*)?(.*)$/);
    const prefix = match?.[1] ?? "";
    const originalBody = match?.[2] ?? line;
    const body = originalBody.trim().replace(/\]\s+\[/g, "][");
    const normalized = imageLine.test(body)
      ? `${prefix}${body}`
      : `${prefix}${originalBody.replace(paddedTag, "$1")}`;

    if (imageLine.test(body) && compacted.length > 0) {
      const previous = compacted.at(-1) ?? "";
      const previousMatch = previous.match(/^(\s*>\s*)?(.*)$/);
      const previousPrefix = previousMatch?.[1] ?? "";
      const previousBody = previousMatch?.[2] ?? previous;
      if (previousPrefix === prefix && imageLine.test(previousBody)) {
        compacted[compacted.length - 1] = `${previous}${body}`;
        continue;
      }
    }
    compacted.push(normalized);
  }
  return compacted.join("\n");
};

/** Drops reply and quote objects while retaining the requested tweet itself. */
export const takeRootTweet = (tweet: Tweet): ProcessedTweet => {
  const { quote: _quote, replyTo: _replyTo, ...root } = processTweet(tweet);
  return root;
};

/** Stringifies one X post while routing media through the narrow uploaders. */
export const stringifyRootTweet = async (
  tweet: ProcessedTweet | TweetViaProxy,
  uploadMedia: XMediaUploader = uploadXMedia,
): Promise<string> => {
  const url = new URL(
    `https://twitter.com/${
      "author" in tweet ? tweet.author.screenName : tweet.screenName
    }/status/${tweet.id}`,
  );
  if ("images" in tweet) {
    const description = tweet.description?.trim()
      ? tweet.description.split("\n").map((line) => `> ${escapeForEmbed(line)}`)
      : tweet.images.length === 0
      ? ["> [/ no description provided]"]
      : [];
    return [
      `> [@${escapeForEmbed(tweet.screenName)} ${url.origin}${url.pathname}]`,
      ...description,
      ...(tweet.images.length > 0
        ? [`> ${tweet.images.map((image) => `[${image}]`).join("")}`]
        : []),
    ].join("\n");
  }

  const renderMedia = async (media: Media[]): Promise<string> => {
    const lines: string[] = [];
    for (let index = 0; index < media.length; index += 2) {
      const first = `[${await uploadMedia(media[index], url)}]`;
      const second = media[index + 1]
        ? `[${await uploadMedia(media[index + 1], url)}]`
        : "";
      lines.push(`${first}${second}`);
    }
    return `\n${lines.join("\n")}\n`;
  };

  const body = (await Promise.all(tweet.content.map((node) => {
    switch (node.type) {
      case "plain":
        return node.text;
      case "hashtag":
        return ` #${node.text} `;
      case "symbol":
        return ` #$${node.text} `;
      case "mention":
        return `[@${node.screenName} https://twitter.com/${node.screenName}]`;
      case "media":
        return renderMedia(node.media);
      case "url":
        return `${convertScrapboxURL()(node.url)} `;
    }
  }))).join("").replace(/^\n+|\n+$/g, "");
  return [
    `[@${escapeForEmbed(tweet.author.screenName)} ${url}]`,
    ...body.split("\n"),
  ].join("\n");
};

/** X formatter that expands only the URL's tweet, not its parent or quote. */
export const formatRootTweet: TweetFormatter = async (
  tweet: Tweet | TweetViaProxy,
): Promise<string> => {
  if ("images" in tweet) {
    return normalizeTweetOutput(await stringifyRootTweet(tweet));
  }

  const rendered = normalizeTweetOutput(
    await stringifyRootTweet(takeRootTweet(tweet)),
  );
  return rendered.split("\n").map((line) => `> ${line}`).join("\n");
};
