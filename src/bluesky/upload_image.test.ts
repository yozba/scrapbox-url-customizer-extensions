import { assertEquals, assertInstanceOf } from "jsr:@std/assert@^1.0.19";
import { createBlueskyImageUploader } from "./upload_image.ts";

Deno.test("Bluesky images are downloaded and uploaded to Gyazo once", async () => {
  let downloadCount = 0;
  let uploadCount = 0;
  const uploader = createBlueskyImageUploader({
    getToken: () => Promise.resolve("gyazo-token"),
    download: () => {
      downloadCount++;
      return Promise.resolve(
        new Response(new Blob(["image"], { type: "image/jpeg" })),
      );
    },
    upload: (_input, init) => {
      uploadCount++;
      const form = init?.body;
      assertInstanceOf(form, FormData);
      assertEquals(form.get("access_token"), "gyazo-token");
      assertEquals(form.get("referer_url"), "https://bsky.app/post/1");
      assertEquals(form.get("desc"), "alternative text");
      assertInstanceOf(form.get("imagedata"), File);
      return Promise.resolve(Response.json({
        permalink_url: "https://gyazo.com/uploaded-image",
      }));
    },
  });
  const image = {
    thumb: "https://cdn.test/thumb",
    fullsize: "https://cdn.test/fullsize",
    alt: "alternative text",
  };
  const postURL = new URL("https://bsky.app/post/1");

  assertEquals(
    await uploader(image, postURL),
    new URL("https://gyazo.com/uploaded-image"),
  );
  assertEquals(
    await uploader(image, postURL),
    new URL("https://gyazo.com/uploaded-image"),
  );
  assertEquals(downloadCount, 1);
  assertEquals(uploadCount, 1);
});
