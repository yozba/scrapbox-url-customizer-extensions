import { assertEquals } from "../../test_deps.ts";
import {
  fetchMastodonStatus,
  type MastodonStatus,
  parseMastodonPostURL,
  renderMastodonHTML,
  stringifyMastodonStatus,
} from "./mastodon.ts";

Deno.test("parseMastodonPostURL accepts public status URL forms", () => {
  assertEquals(
    parseMastodonPostURL(
      new URL("https://social.example/@alice/12345?ref=x#fragment"),
    ),
    {
      id: "12345",
      canonicalURL: new URL("https://social.example/@alice/12345"),
    },
  );
  assertEquals(
    parseMastodonPostURL(
      new URL("https://social.example/users/alice/statuses/67890"),
    )?.id,
    "67890",
  );
  assertEquals(
    parseMastodonPostURL(new URL("https://example.com/articles/123")),
    undefined,
  );
});

Deno.test("fetchMastodonStatus uses the selected instance public API", async () => {
  const requests: string[] = [];
  const reference = parseMastodonPostURL(
    new URL("https://social.example/@alice/12345"),
  )!;
  const status = await fetchMastodonStatus(reference, (input, init) => {
    requests.push(`${input}:${init?.credentials}`);
    return Promise.resolve(Response.json({
      id: "12345",
      content: "<p>Hello</p>",
      spoiler_text: "",
      account: { acct: "alice" },
      media_attachments: [],
    }));
  });

  assertEquals(status.id, "12345");
  assertEquals(requests, [
    "https://social.example/api/v1/statuses/12345:omit",
  ]);
});

Deno.test("renderMastodonHTML keeps links, mentions, hashtags, and breaks", () => {
  assertEquals(
    renderMastodonHTML(
      '<p>Hello <a href="https://example.com/page">website</a><br>' +
        '<a href="https://social.example/@bob" class="mention">@bob</a> ' +
        '<a href="https://social.example/tags/test" class="hashtag">#test</a></p>',
      new URL("https://social.example/@alice/1"),
    ),
    "Hello [website https://example.com/page]\n" +
      "[@bob https://social.example/@bob] #test",
  );
});

Deno.test("stringifyMastodonStatus expands only the selected status media", async () => {
  const calls: string[] = [];
  const status: MastodonStatus = {
    id: "12345",
    content: "<p>Hello</p>",
    spoiler_text: "spoiler",
    account: { acct: "alice" },
    media_attachments: [
      {
        type: "image",
        url: "https://cdn.example/one.jpg",
        description: "one",
      },
      {
        type: "image",
        url: "https://cdn.example/two.png",
        description: "two",
      },
      {
        type: "video",
        url: "https://cdn.example/movie.mp4",
        description: "movie",
      },
    ],
  };
  const result = await stringifyMastodonStatus(
    status,
    new URL("https://social.example/@alice/12345"),
    {
      uploadImage: (image) => {
        calls.push(`image:${image.fullsize}:${image.alt}`);
        return Promise.resolve(new URL(`https://gyazo.com/${calls.length}`));
      },
      uploadVideo: (url, _postURL, description) => {
        calls.push(`video:${url}:${description}`);
        return Promise.resolve(new URL("https://gyazo.com/video"));
      },
    },
  );

  assertEquals(
    result,
    [
      "> [@alice@social.example https://social.example/@alice/12345]",
      "> CW: spoiler",
      "> Hello",
      "> [https://gyazo.com/1][https://gyazo.com/2]",
      "> [https://gyazo.com/video]",
    ].join("\n"),
  );
  assertEquals(calls, [
    "image:https://cdn.example/one.jpg:one",
    "image:https://cdn.example/two.png:two",
    "video:https://cdn.example/movie.mp4:movie",
  ]);
});
