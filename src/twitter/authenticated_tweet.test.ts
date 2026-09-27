import { assertEquals, assertRejects } from "../../test_deps.ts";
import {
  formatAuthenticatedTweet,
  parseXPostURL,
  processAuthenticatedTweetResult,
} from "./authenticated_tweet.ts";

const graphqlTweet = {
  data: {
    tweetResult: {
      result: {
        __typename: "TweetWithVisibilityResults",
        tweet: {
          __typename: "Tweet",
          rest_id: "123",
          core: {
            user_results: {
              result: {
                legacy: { name: "Alice", screen_name: "alice" },
              },
            },
          },
          legacy: {
            created_at: "Sat Sep 27 00:00:00 +0000 2026",
            full_text: "hello #test",
            reply_count: 4,
            entities: {
              hashtags: [{ text: "test", indices: [6, 11] }],
            },
          },
        },
      },
    },
  },
};

Deno.test("parseXPostURL accepts X and Twitter status URLs", () => {
  assertEquals(
    parseXPostURL(new URL("https://x.com/alice/status/123?s=20"))?.id,
    "123",
  );
  assertEquals(
    parseXPostURL(new URL("https://mobile.twitter.com/a/statuses/456"))?.id,
    "456",
  );
  assertEquals(parseXPostURL(new URL("https://x.com/home")), undefined);
});

Deno.test("authenticated GraphQL visibility results become processed tweets", () => {
  const tweet = processAuthenticatedTweetResult(graphqlTweet, "123");
  assertEquals(tweet.id, "123");
  assertEquals(tweet.author, { name: "Alice", screenName: "alice" });
  assertEquals(tweet.replyCount, 4);
  assertEquals(tweet.content, [
    { type: "plain", text: "hello " },
    { type: "hashtag", text: "test" },
  ]);
});

Deno.test("authenticated X media keeps the highest bitrate MP4", () => {
  const payload = structuredClone(graphqlTweet);
  const result = payload.data.tweetResult.result.tweet;
  result.legacy.full_text = "video https://t.co/media";
  Object.assign(result.legacy.entities, {
    media: [{
      indices: [6, 24],
      url: "https://t.co/media",
      media_url_https: "https://pbs.twimg.com/thumb.jpg",
      type: "video",
    }],
  });
  Object.assign(result.legacy, {
    extended_entities: {
      media: [{
        url: "https://t.co/media",
        media_url_https: "https://pbs.twimg.com/thumb.jpg",
        type: "video",
        video_info: {
          variants: [
            { url: "https://video.twimg.com/low.mp4", bitrate: 256000 },
            { url: "https://video.twimg.com/video.m3u8" },
            { url: "https://video.twimg.com/high.mp4", bitrate: 2176000 },
          ],
        },
      }],
    },
  });

  const tweet = processAuthenticatedTweetResult(payload, "123");
  assertEquals(tweet.content.at(-1), {
    type: "media",
    media: [{
      type: "video",
      url: new URL("https://video.twimg.com/high.mp4"),
    }],
  });
});

Deno.test("authenticated X uses Note Tweet text and entities", () => {
  const payload = structuredClone(graphqlTweet);
  Object.assign(payload.data.tweetResult.result.tweet, {
    note_tweet: {
      note_tweet_results: {
        result: {
          text: "a longer post #long",
          entity_set: {
            hashtags: [{ text: "long", indices: [14, 19] }],
          },
        },
      },
    },
  });

  const tweet = processAuthenticatedTweetResult(payload, "123");
  assertEquals(tweet.content, [
    { type: "plain", text: "a longer post " },
    { type: "hashtag", text: "long" },
  ]);
});

Deno.test("X middleware uses authentication only after public failure", async () => {
  let authenticatedCalls = 0;
  const middleware = formatAuthenticatedTweet({
    publicMiddleware: () => Promise.reject(new Error("not public")),
    getTweet: () => {
      authenticatedCalls++;
      return Promise.resolve(graphqlTweet);
    },
  });
  const result = await middleware(new URL("https://x.com/alice/status/123"));
  assertEquals(
    result,
    "> [@alice https://twitter.com/alice/status/123]\n> hello #test",
  );
  assertEquals(authenticatedCalls, 1);

  const publicMiddleware = formatAuthenticatedTweet({
    publicMiddleware: () => Promise.resolve("public result"),
    getTweet: () => {
      authenticatedCalls++;
      return Promise.resolve(graphqlTweet);
    },
  });
  assertEquals(
    await publicMiddleware(new URL("https://x.com/alice/status/123")),
    "public result",
  );
  assertEquals(authenticatedCalls, 1);
});

Deno.test("X middleware uses anonymous syndication before authentication", async () => {
  let authenticatedCalls = 0;
  const middleware = formatAuthenticatedTweet({
    fetcher: (input, init) => {
      assertEquals(
        input.toString(),
        "https://cdn.syndication.twimg.com/tweet-result?id=123&token=x",
      );
      assertEquals(init?.credentials, "omit");
      return Promise.resolve(Response.json({
        __typename: "Tweet",
        id_str: "123",
        text: "public post",
        user: { name: "Alice", screen_name: "alice" },
        created_at: "Sat Sep 27 00:00:00 +0000 2026",
        conversation_count: 0,
        entities: {},
      }));
    },
    getTweet: () => {
      authenticatedCalls++;
      return Promise.resolve(graphqlTweet);
    },
  });

  assertEquals(
    await middleware(new URL("https://x.com/alice/status/123")),
    "> [@alice https://twitter.com/alice/status/123]\n> public post",
  );
  assertEquals(authenticatedCalls, 0);
});

Deno.test("X middleware reports both failures when the bridge is absent", async () => {
  const middleware = formatAuthenticatedTweet({
    publicMiddleware: () => Promise.reject(new Error("not public")),
  });
  await assertRejects(
    () =>
      middleware(new URL("https://x.com/alice/status/123")) as Promise<unknown>,
    AggregateError,
    "Public and authenticated X post expansion both failed",
  );
});
