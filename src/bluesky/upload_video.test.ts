import { assertEquals, assertInstanceOf } from "jsr:@std/assert@^1.0.19";
import {
  createBlueskyVideoUploader,
  resolveBlueskyPDS,
} from "./upload_video.ts";
import type { BlueskyPost } from "./types.ts";

Deno.test("resolveBlueskyPDS reads the AT Protocol service", async () => {
  const pds = await resolveBlueskyPDS(
    "did:plc:alice",
    (input) => {
      assertEquals(input.toString(), "https://plc.directory/did:plc:alice");
      return Promise.resolve(Response.json({
        service: [{
          id: "did:plc:alice#atproto_pds",
          type: "AtprotoPersonalDataServer",
          serviceEndpoint: "https://alice.pds.test",
        }],
      }));
    },
  );
  assertEquals(pds, new URL("https://alice.pds.test"));
});

Deno.test("Bluesky videos are downloaded and uploaded to Gyazo once", async () => {
  const requested: URL[] = [];
  let uploadCount = 0;
  const uploader = createBlueskyVideoUploader({
    getToken: () => Promise.resolve("gyazo-token"),
    fetcher: (input) => {
      const url = new URL(input.toString());
      requested.push(url);
      if (url.hostname === "plc.directory") {
        return Promise.resolve(Response.json({
          service: [{
            id: "did:plc:alice#atproto_pds",
            serviceEndpoint: "https://alice.pds.test",
          }],
        }));
      }
      if (url.hostname === "alice.pds.test") {
        assertEquals(url.searchParams.get("did"), "did:plc:alice");
        assertEquals(url.searchParams.get("cid"), "video-cid");
        return Promise.resolve(
          new Response(new Blob(["video"], { type: "video/mp4" })),
        );
      }

      throw new Error(`Unexpected download: ${url}`);
    },
    upload: (input, init) => {
      uploadCount++;
      assertEquals(input.toString(), "https://upload.gyazo.com/api/upload");
      assertEquals(init?.credentials, "omit");
      const form = init?.body;
      assertInstanceOf(form, FormData);
      assertInstanceOf(form.get("imagedata"), File);
      assertEquals(form.get("access_token"), "gyazo-token");
      assertEquals(form.get("title"), "video description");
      return Promise.resolve(
        Response.json({ permalink_url: "https://gyazo.com/video-id" }),
      );
    },
  });
  const post: BlueskyPost = {
    uri: "at://did:plc:alice/app.bsky.feed.post/3abc",
    cid: "post-cid",
    author: { did: "did:plc:alice", handle: "alice.test" },
    record: { text: "video", createdAt: "2026-01-01T00:00:00Z" },
    indexedAt: "2026-01-01T00:00:00Z",
  };
  const video = {
    cid: "video-cid",
    playlist: "https://video.bsky.app/playlist.m3u8",
    alt: "video description",
  };
  const postURL = new URL("https://bsky.app/profile/alice.test/post/3abc");

  assertEquals(
    await uploader(video, post, postURL),
    new URL("https://gyazo.com/video-id"),
  );
  assertEquals(
    await uploader(video, post, postURL),
    new URL("https://gyazo.com/video-id"),
  );
  assertEquals(requested.length, 2);
  assertEquals(uploadCount, 1);
});

Deno.test("a failed Gyazo upload falls back to the source MP4 URL", async () => {
  const uploader = createBlueskyVideoUploader({
    getToken: () => Promise.resolve(undefined),
    fetcher: (input) => {
      const url = new URL(input.toString());
      if (url.hostname === "plc.directory") {
        return Promise.resolve(Response.json({
          service: [{
            id: "did:plc:alice#atproto_pds",
            serviceEndpoint: "https://alice.pds.test",
          }],
        }));
      }
      return Promise.resolve(
        new Response(new Blob(["video"], { type: "video/mp4" })),
      );
    },
    sessionUpload: () =>
      Promise.resolve(new Response("not allowed", { status: 403 })),
  });
  const post: BlueskyPost = {
    uri: "at://did:plc:alice/app.bsky.feed.post/3abc",
    cid: "post-cid",
    author: { did: "did:plc:alice", handle: "alice.test" },
    record: { text: "video", createdAt: "2026-01-01T00:00:00Z" },
    indexedAt: "2026-01-01T00:00:00Z",
  };
  const result = await uploader(
    {
      cid: "video-cid",
      playlist: "https://video.bsky.app/playlist.m3u8",
    },
    post,
    new URL("https://bsky.app/profile/alice.test/post/3abc"),
  );

  assertEquals(result.hostname, "alice.pds.test");
  assertEquals(result.pathname, "/xrpc/com.atproto.sync.getBlob");
  assertEquals(result.searchParams.get("cid"), "video-cid");
});
