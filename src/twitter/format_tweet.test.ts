import { assertEquals } from "jsr:@std/assert@^1.0.19";
import type { Tweet } from "jsr:@takker/scrapbox-url-customizer@^0.4.8";
import { normalizeTweetOutput, takeRootTweet } from "./format_tweet.ts";

Deno.test("normalizeTweetOutput removes the final line and compacts images", () => {
  assertEquals(
    normalizeTweetOutput(
      "[@alice https://twitter.com/alice/status/1]\nhello\n[https://img/1] [https://img/2]\n[https://img/3]\n",
    ),
    "[@alice https://twitter.com/alice/status/1]\nhello\n[https://img/1][https://img/2][https://img/3]",
  );
});

Deno.test("takeRootTweet removes reply and quote expansion", () => {
  const base = {
    id_str: "1",
    text: "hello",
    user: { name: "Alice", screen_name: "alice" },
    created_at: "2026-01-01T00:00:00Z",
    conversation_count: 0,
    entities: {},
  } as unknown as Tweet;
  const nested = {
    ...base,
    id_str: "2",
    reply_count: 0,
    retweet_count: 0,
  } as NonNullable<Tweet["parent"]>;
  const root = takeRootTweet({
    ...base,
    parent: nested,
    quoted_tweet: { ...nested, id_str: "3" },
  });
  assertEquals(root.id, "1");
  assertEquals("replyTo" in root, false);
  assertEquals("quote" in root, false);
});
