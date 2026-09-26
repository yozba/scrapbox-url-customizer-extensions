import {
  stringify,
  type Tweet,
  type TweetFormatter,
  type TweetViaProxy,
} from "jsr:@takker/scrapbox-url-customizer@^0.4.8";
import type { ProcessedTweet } from "jsr:@takker/scrapbox-url-customizer@^0.4.8";
import { processTweet } from "./process_tweet.ts";

const imageLine = /^(?:\[https?:\/\/[^\]\r\n]+\])+$/;

/** Removes the upstream trailing blank line and compacts image rows. */
export const normalizeTweetOutput = (text: string): string => {
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  while (lines.at(-1)?.trim() === "") lines.pop();

  const compacted: string[] = [];
  for (const line of lines) {
    const match = line.match(/^(\s*>\s*)?(.*)$/);
    const prefix = match?.[1] ?? "";
    const body = (match?.[2] ?? line).trim().replace(/\]\s+\[/g, "][");
    const normalized = imageLine.test(body) ? `${prefix}${body}` : line;

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

/** X formatter that expands only the URL's tweet, not its parent or quote. */
export const formatRootTweet: TweetFormatter = async (
  tweet: Tweet | TweetViaProxy,
): Promise<string> => {
  if ("images" in tweet) {
    return normalizeTweetOutput(await stringify(tweet));
  }

  const rendered = normalizeTweetOutput(await stringify(takeRootTweet(tweet)));
  return rendered.split("\n").map((line) => `> ${line}`).join("\n");
};
