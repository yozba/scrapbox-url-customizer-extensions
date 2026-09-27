import { assertEquals } from "../../test_deps.ts";
import {
  createVideoFileUploader,
  isVideoTooLargeToUpload,
  MAX_SESSION_BRIDGE_BYTES,
  MAX_VIDEO_UPLOAD_BYTES,
} from "./upload_video.ts";

Deno.test("declared video sizes over 64 MiB are detected", () => {
  assertEquals(
    isVideoTooLargeToUpload(
      new Response(null, {
        headers: { "content-length": String(MAX_VIDEO_UPLOAD_BYTES + 1) },
      }),
    ),
    true,
  );
  assertEquals(
    isVideoTooLargeToUpload(
      new Response(null, {
        headers: { "content-length": String(MAX_VIDEO_UPLOAD_BYTES) },
      }),
    ),
    false,
  );
  assertEquals(isVideoTooLargeToUpload(new Response()), false);
});

Deno.test("video uploads use the OAuth bridge before fetch", async () => {
  const calls: string[] = [];
  const uploader = createVideoFileUploader({
    getToken: () => Promise.resolve("gyazo-token"),
    oauthUpload: (file, token, sourceURL, title) => {
      calls.push(`${file.name}:${token}:${sourceURL}:${title}`);
      return Promise.resolve("https://gyazo.com/video-id");
    },
    upload: () => {
      throw new Error("the CORS fetch fallback must not run");
    },
    fallbackUpload: () => {
      throw new Error("the storage fallback must not run");
    },
  });
  const file = new File(["video"], "x-video.mp4", { type: "video/mp4" });
  const sourceURL = new URL("https://x.com/alice/status/1");

  assertEquals(
    await uploader(file, sourceURL),
    new URL("https://gyazo.com/video-id"),
  );
  assertEquals(calls, [
    "x-video.mp4:gyazo-token:https://x.com/alice/status/1:x-video.mp4",
  ]);
});

Deno.test("oversized videos skip the extension session bridge", async () => {
  let sessionCalls = 0;
  let storedFile: File | undefined;
  const uploader = createVideoFileUploader({
    getToken: () => Promise.resolve(undefined),
    sessionUpload: () => {
      sessionCalls++;
      return Promise.resolve("https://gyazo.com/must-not-upload");
    },
    fallbackUpload: (file) => {
      storedFile = file;
      return Promise.resolve(new URL("https://scrapbox.io/files/video.mp4"));
    },
  });
  const file = {
    name: "large.mp4",
    type: "video/mp4",
    size: MAX_SESSION_BRIDGE_BYTES + 1,
  } as File;

  assertEquals(
    await uploader(file, new URL("https://x.com/alice/status/1")),
    new URL("https://scrapbox.io/files/video.mp4"),
  );
  assertEquals(sessionCalls, 0);
  assertEquals(storedFile, file);
});

Deno.test("videos over 64 MiB skip every upload path", async () => {
  const calls: string[] = [];
  const uploader = createVideoFileUploader({
    getToken: () => {
      calls.push("token");
      return Promise.resolve("gyazo-token");
    },
    oauthUpload: () => {
      calls.push("oauth bridge");
      return Promise.resolve("https://gyazo.com/must-not-upload");
    },
    upload: () => {
      calls.push("oauth fetch");
      return Promise.resolve(new Response());
    },
    sessionUpload: () => {
      calls.push("session bridge");
      return Promise.resolve("https://gyazo.com/must-not-upload");
    },
    fallbackUpload: () => {
      calls.push("Cosense storage");
      return Promise.resolve(new URL("https://scrapbox.io/files/video.mp4"));
    },
  });
  const file = {
    name: "large.mp4",
    type: "video/mp4",
    size: MAX_VIDEO_UPLOAD_BYTES + 1,
  } as File;

  let error: unknown;
  try {
    await uploader(file, new URL("https://x.com/alice/status/1"));
  } catch (caught) {
    error = caught;
  }

  assertEquals(error instanceof RangeError, true);
  assertEquals(
    (error as Error).message,
    "The video exceeds 64 MiB; use its original URL instead",
  );
  assertEquals(calls, []);
});
