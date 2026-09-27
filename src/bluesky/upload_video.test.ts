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
    fetcher: (input, init) => {
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

      uploadCount++;
      assertEquals(url.href, "https://gif.gyazo.com/gif/upload");
      assertEquals(init?.credentials, "include");
      const form = init?.body;
      assertInstanceOf(form, FormData);
      assertInstanceOf(form.get("data"), File);
      const metadata = JSON.parse(String(form.get("metadata")));
      assertEquals(metadata.title, "video description");
      return Promise.resolve(
        new Response("https://gyazo.com/video-id", { status: 200 }),
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
  assertEquals(requested.length, 3);
  assertEquals(uploadCount, 1);
});
