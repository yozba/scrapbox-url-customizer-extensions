import { assertEquals } from "../../test_deps.ts";
import {
  createVideoFileUploader,
  MAX_SESSION_BRIDGE_BYTES,
} from "./upload_video.ts";

Deno.test("video uploads use the iframe OAuth bridge before fetch", async () => {
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
