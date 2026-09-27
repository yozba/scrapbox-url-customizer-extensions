import { assertEquals } from "../../test_deps.ts";
import type { ProcessedTweet, Tweet } from "../deps/scrapbox_url_customizer.ts";
import {
  normalizeTweetOutput,
  stringifyRootTweet,
  takeRootTweet,
} from "./format_tweet.ts";

Deno.test("normalizeTweetOutput removes the final line and compacts images", () => {
  assertEquals(
    normalizeTweetOutput(
      "[@alice https://twitter.com/alice/status/1]\nhello\n[https://img/1] [https://img/2]\n[https://img/3]\n",
    ),
    "[@alice https://twitter.com/alice/status/1]\nhello\n[https://img/1][https://img/2][https://img/3]",
  );
});

Deno.test("normalizeTweetOutput removes formatter padding around hashtags", () => {
  assertEquals(
    normalizeTweetOutput(
      "[@alice https://twitter.com/alice/status/1]\n #first  hello\nnext  #second \n #one   #two \n",
    ),
    "[@alice https://twitter.com/alice/status/1]\n#first hello\nnext #second\n#one #two",
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

Deno.test("stringifyRootTweet uses the injected narrow media uploader", async () => {
  const uploaded: string[] = [];
  const tweet = {
    id: "1",
    author: { name: "Alice", screenName: "alice" },
    posted: new Date("2026-01-01T00:00:00Z"),
    replyCount: 0,
    content: [{
      type: "media",
      media: [{
        type: "video",
        url: new URL("https://video.twimg.com/source.mp4"),
      }],
    }],
  } as ProcessedTweet;
  const result = await stringifyRootTweet(tweet, (media) => {
    uploaded.push(media.url.href);
    return Promise.resolve(new URL("https://gyazo.com/video-id"));
  });

  assertEquals(uploaded, ["https://video.twimg.com/source.mp4"]);
  assertEquals(
    normalizeTweetOutput(result),
    "[@alice https://twitter.com/alice/status/1]\n[https://gyazo.com/video-id]",
  );
});
