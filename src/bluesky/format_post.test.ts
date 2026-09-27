import { assertEquals, assertStringIncludes } from "../../test_deps.ts";
import {
  fetchBlueskyPost,
  parseBlueskyPostURL,
  resolveBlueskyActor,
} from "./fetch_post.ts";
import { renderBlueskyText, stringifyBlueskyPost } from "./format_post.ts";
import type { BlueskyPost } from "./types.ts";

Deno.test("parseBlueskyPostURL accepts only post URLs", () => {
  assertEquals(
    parseBlueskyPostURL(
      new URL("https://bsky.app/profile/alice.test/post/3abc?foo=bar"),
    ),
    { actor: "alice.test", rkey: "3abc" },
  );
  assertEquals(
    parseBlueskyPostURL(new URL("https://bsky.app/profile/alice.test")),
    undefined,
  );
});

Deno.test("resolveBlueskyActor skips the network for DIDs", async () => {
  let called = false;
  const did = await resolveBlueskyActor("did:plc:alice", () => {
    called = true;
    return Promise.reject(new Error("must not be called"));
  });
  assertEquals(did, "did:plc:alice");
  assertEquals(called, false);
});

Deno.test("fetchBlueskyPost resolves a handle and requests one AT URI", async () => {
  const requested: URL[] = [];
  const fetcher = (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(input.toString());
    requested.push(url);
    if (url.pathname.endsWith("resolveHandle")) {
      return Promise.resolve(Response.json({ did: "did:plc:alice" }));
    }
    return Promise.resolve(Response.json({
      posts: [{
        uri: "at://did:plc:alice/app.bsky.feed.post/3abc",
        cid: "cid",
        author: { did: "did:plc:alice", handle: "alice.test" },
        record: { text: "hello", createdAt: "2026-01-01T00:00:00Z" },
        indexedAt: "2026-01-01T00:00:00Z",
      }],
    }));
  };
  const post = await fetchBlueskyPost(
    { actor: "alice.test", rkey: "3abc" },
    fetcher,
  );
  assertEquals(post.author.handle, "alice.test");
  assertEquals(requested.length, 2);
  assertEquals(
    requested[1].searchParams.get("uris"),
    "at://did:plc:alice/app.bsky.feed.post/3abc",
  );
});

Deno.test("renderBlueskyText honors UTF-8 byte offsets", () => {
  const text = "絵文字😀 https://example.com";
  const prefix = "絵文字😀 ";
  const start = new TextEncoder().encode(prefix).length;
  const end = new TextEncoder().encode(text).length;
  assertEquals(
    renderBlueskyText(text, [{
      index: { byteStart: start, byteEnd: end },
      features: [{
        $type: "app.bsky.richtext.facet#link",
        uri: "https://example.org/full",
      }],
    }]),
    "絵文字😀 https://example.org/full",
  );
});

Deno.test("stringifyBlueskyPost uploads and compacts images", async () => {
  const post: BlueskyPost = {
    uri: "at://did:plc:alice/app.bsky.feed.post/3abc",
    cid: "cid",
    author: { did: "did:plc:alice", handle: "alice.test" },
    record: { text: "hello", createdAt: "2026-01-01T00:00:00Z" },
    indexedAt: "2026-01-01T00:00:00Z",
    embed: {
      $type: "app.bsky.embed.recordWithMedia#view",
      record: { value: { text: "quoted text must not appear" } },
      media: {
        $type: "app.bsky.embed.images#view",
        images: [
          { thumb: "thumb-1", fullsize: "https://cdn.test/image-one" },
          { thumb: "thumb-2", fullsize: "https://cdn.test/image-two" },
        ],
      },
    },
  };
  const uploaded: string[] = [];
  const result = await stringifyBlueskyPost(
    post,
    new URL("https://bsky.app/profile/alice.test/post/3abc?x=1"),
    (image) => {
      uploaded.push(image.fullsize);
      return Promise.resolve(
        new URL(`https://gyazo.com/${uploaded.length}`),
      );
    },
  );
  assertStringIncludes(
    result,
    "> [https://gyazo.com/1][https://gyazo.com/2]",
  );
  assertEquals(uploaded, [
    "https://cdn.test/image-one",
    "https://cdn.test/image-two",
  ]);
  assertEquals(result.includes("quoted text"), false);
  assertEquals(result.endsWith("\n"), false);
});

Deno.test("stringifyBlueskyPost uploads its video but not quoted media", async () => {
  const post: BlueskyPost = {
    uri: "at://did:plc:alice/app.bsky.feed.post/3video",
    cid: "post-cid",
    author: { did: "did:plc:alice", handle: "alice.test" },
    record: { text: "video", createdAt: "2026-01-01T00:00:00Z" },
    indexedAt: "2026-01-01T00:00:00Z",
    embed: {
      $type: "app.bsky.embed.recordWithMedia#view",
      record: { value: { embed: { playlist: "quoted-playlist" } } },
      media: {
        $type: "app.bsky.embed.video#view",
        cid: "video-cid",
        playlist: "https://video.bsky.app/playlist.m3u8",
      },
    },
  };
  const videos: string[] = [];
  const result = await stringifyBlueskyPost(
    post,
    new URL("https://bsky.app/profile/alice.test/post/3video"),
    (image) => Promise.resolve(new URL(image.fullsize)),
    (video) => {
      videos.push(video.cid);
      return Promise.resolve(new URL("https://gyazo.com/video-id"));
    },
  );
  assertEquals(videos, ["video-cid"]);
  assertStringIncludes(result, "> [https://gyazo.com/video-id]");
  assertEquals(result.includes("quoted-playlist"), false);
});
