import { assertEquals, assertStringIncludes } from "../../test_deps.ts";
import {
  extractInstagramMedia,
  stringifyInstagramPost,
} from "./format_post.ts";
import type { InstagramPost } from "./types.ts";

const reference = {
  shortcode: "ABC123",
  canonicalURL: new URL("https://www.instagram.com/p/ABC123/"),
};

Deno.test("stringifyInstagramPost uses the public thumbnail as a fallback", async () => {
  const post: InstagramPost = {
    reference,
    oembed: {
      media_id: "123_456",
      author_name: "alice",
      title: "first line\n#tag",
      thumbnail_url: "https://cdn.test/cover.jpg?signed=1",
    },
  };
  const result = await stringifyInstagramPost(post, {
    uploadImage: () => Promise.resolve(new URL("https://gyazo.com/image-id")),
  });

  assertStringIncludes(
    result,
    "> [@alice https://www.instagram.com/p/ABC123/]",
  );
  assertStringIncludes(result, "> first line\n> #tag");
  assertStringIncludes(result, "> [https://gyazo.com/image-id]");
});

Deno.test("authenticated carousels include every image and video", async () => {
  const post: InstagramPost = {
    reference,
    oembed: { media_id: "123_456", title: "public caption" },
    authenticated: {
      caption: { text: "private API caption" },
      user: { username: "alice" },
      carousel_media: [
        {
          image_versions2: {
            candidates: [
              { url: "https://cdn.test/small.jpg", width: 100, height: 100 },
              { url: "https://cdn.test/large.jpg", width: 1000, height: 1000 },
            ],
          },
        },
        {
          image_versions2: {
            candidates: [
              { url: "https://cdn.test/second.jpg", width: 800, height: 600 },
            ],
          },
        },
        {
          video_versions: [
            { url: "https://cdn.test/video.mp4", width: 720, height: 1280 },
          ],
        },
      ],
    },
  };
  assertEquals(
    extractInstagramMedia(post).map((item) => [item.type, item.url.href]),
    [
      ["image", "https://cdn.test/large.jpg"],
      ["image", "https://cdn.test/second.jpg"],
      ["video", "https://cdn.test/video.mp4"],
    ],
  );

  const uploadedImages: string[] = [];
  const uploadedVideos: string[] = [];
  const result = await stringifyInstagramPost(post, {
    uploadImage: (url) => {
      uploadedImages.push(url.href);
      return Promise.resolve(
        new URL(`https://gyazo.com/image-${uploadedImages.length}`),
      );
    },
    uploadVideo: (url) => {
      uploadedVideos.push(url.href);
      return Promise.resolve(new URL("https://gyazo.com/video-id"));
    },
  });

  assertEquals(uploadedImages, [
    "https://cdn.test/large.jpg",
    "https://cdn.test/second.jpg",
  ]);
  assertEquals(uploadedVideos, ["https://cdn.test/video.mp4"]);
  assertStringIncludes(
    result,
    "> [https://gyazo.com/image-1][https://gyazo.com/image-2]",
  );
  assertStringIncludes(result, "> [https://gyazo.com/video-id]");
});
