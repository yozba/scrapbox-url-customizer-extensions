import { assertEquals } from "../../test_deps.ts";
import { fetchInstagramPost, parseInstagramPostURL } from "./fetch_post.ts";

Deno.test("parseInstagramPostURL accepts post, reel, and TV URLs", () => {
  for (const path of ["p", "reel", "reels", "tv"]) {
    const result = parseInstagramPostURL(
      new URL(`https://www.instagram.com/${path}/Ab_c-12/?igsh=test`),
    );
    assertEquals(result?.shortcode, "Ab_c-12");
    assertEquals(
      result?.canonicalURL.href,
      `https://www.instagram.com/${path}/Ab_c-12/`,
    );
  }
  assertEquals(
    parseInstagramPostURL(new URL("https://www.instagram.com/natgeo/")),
    undefined,
  );
});

Deno.test("fetchInstagramPost uses authenticated media when available", async () => {
  const requests: URL[] = [];
  const reference = parseInstagramPostURL(
    new URL("https://www.instagram.com/p/ABC123/"),
  )!;
  const post = await fetchInstagramPost(reference, {
    fetcher: (input, init) => {
      const url = new URL(input.toString());
      requests.push(url);
      assertEquals(url.pathname, "/api/v1/oembed/");
      assertEquals(init?.credentials, "omit");
      return Promise.resolve(Response.json({
        media_id: "123_456",
        title: "public caption",
        author_name: "public-user",
        thumbnail_url: "https://cdn.test/cover.jpg",
      }));
    },
    getAuthenticatedMedia: (mediaId, postURL) => {
      assertEquals(mediaId, "123_456");
      assertEquals(postURL, "https://www.instagram.com/p/ABC123/");
      return Promise.resolve({
        caption: { text: "authenticated caption" },
        user: { username: "authenticated-user" },
      });
    },
  });

  assertEquals(post.authenticated?.caption?.text, "authenticated caption");
  assertEquals(requests.length, 1);
});

Deno.test("fetchInstagramPost falls back to oEmbed when login is unavailable", async () => {
  const reference = parseInstagramPostURL(
    new URL("https://www.instagram.com/reel/ABC123/"),
  )!;
  const post = await fetchInstagramPost(reference, {
    fetcher: (input) => {
      const url = new URL(input.toString());
      return Promise.resolve(
        url.pathname === "/api/v1/oembed/"
          ? Response.json({
            media_id: "123_456",
            title: "caption",
            thumbnail_url: "https://cdn.test/cover.jpg",
          })
          : new Response("unexpected", { status: 500 }),
      );
    },
    getAuthenticatedMedia: () => Promise.resolve(undefined),
  });

  assertEquals(post.authenticated, undefined);
  assertEquals(post.oembed.title, "caption");
});
