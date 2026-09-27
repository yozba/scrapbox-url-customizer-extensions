import { assertEquals } from "../../test_deps.ts";
import {
  fetchMisskeyNote,
  type MisskeyNote,
  parseMisskeyPostURL,
  stringifyMisskeyNote,
} from "./misskey.ts";

Deno.test("parseMisskeyPostURL accepts note URLs", () => {
  assertEquals(
    parseMisskeyPostURL(
      new URL("https://misskey.example/notes/abc_123?foo=bar#fragment"),
    ),
    {
      id: "abc_123",
      canonicalURL: new URL("https://misskey.example/notes/abc_123"),
    },
  );
  assertEquals(
    parseMisskeyPostURL(new URL("https://example.com/notes/not/one")),
    undefined,
  );
});

Deno.test("fetchMisskeyNote delegates only the canonical post URL", async () => {
  const calls: string[] = [];
  const reference = parseMisskeyPostURL(
    new URL("https://misskey.example/notes/abc123"),
  )!;
  const note = await fetchMisskeyNote(reference, (postURL) => {
    calls.push(postURL);
    return Promise.resolve({
      id: "abc123",
      text: "Hello",
      user: { username: "alice", host: null },
      files: [],
    });
  });

  assertEquals(note.id, "abc123");
  assertEquals(calls, ["https://misskey.example/notes/abc123"]);
});

Deno.test("stringifyMisskeyNote formats MFM text and all attached media", async () => {
  const calls: string[] = [];
  const note: MisskeyNote = {
    id: "abc123",
    text: "Hello\n#tag",
    cw: "warning",
    user: { username: "alice", host: null },
    files: [
      {
        type: "image/webp",
        url: "https://cdn.example/image.webp",
        comment: "image alt",
      },
      {
        type: "video/mp4",
        url: "https://cdn.example/movie.mp4",
        comment: "video alt",
      },
    ],
    renote: {
      id: "quoted123",
    },
  };
  const result = await stringifyMisskeyNote(
    note,
    new URL("https://misskey.example/notes/abc123"),
    {
      uploadImage: (image) => {
        calls.push(`image:${image.fullsize}:${image.alt}`);
        return Promise.resolve(new URL("https://gyazo.com/image"));
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
      "> [@alice@misskey.example https://misskey.example/notes/abc123]",
      "> CW: warning",
      "> Hello",
      "> #tag",
      "> Quote: https://misskey.example/notes/quoted123",
      "> [https://gyazo.com/image]",
      "> [https://gyazo.com/video]",
    ].join("\n"),
  );
  assertEquals(calls, [
    "image:https://cdn.example/image.webp:image alt",
    "video:https://cdn.example/movie.mp4:video alt",
  ]);
});
