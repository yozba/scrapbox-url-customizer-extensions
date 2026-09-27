import {
  escapeForEmbed,
  type Middleware,
} from "../deps/scrapbox_url_customizer.ts";
import {
  type FediverseMedia,
  formatFediverseMedia,
  type FormatFediverseMediaOptions,
} from "./media.ts";

export interface MisskeyPostReference {
  id: string;
  canonicalURL: URL;
}

export interface MisskeyUser {
  username: string;
  host?: string | null;
}

export interface MisskeyFile {
  type: string;
  url: string;
  comment?: string | null;
}

export interface MisskeyNote {
  id: string;
  text?: string | null;
  cw?: string | null;
  user: MisskeyUser;
  files: MisskeyFile[];
  renote?: {
    id?: string;
    uri?: string | null;
  } | null;
}

export type MisskeyPublicNoteGetter = (postURL: string) => Promise<unknown>;

const getDefaultNoteGetter = (): MisskeyPublicNoteGetter | undefined =>
  (globalThis as typeof globalThis & {
    GM_Misskey_getNote?: MisskeyPublicNoteGetter;
  }).GM_Misskey_getNote;

export const parseMisskeyPostURL = (
  url: Readonly<URL>,
): MisskeyPostReference | undefined => {
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  const match = url.pathname.match(/^\/notes\/([A-Za-z0-9_-]{1,128})\/?$/);
  if (!match) return undefined;
  const canonicalURL = new URL(url);
  canonicalURL.search = "";
  canonicalURL.hash = "";
  canonicalURL.pathname = `/notes/${match[1]}`;
  return { id: match[1], canonicalURL };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object";

const validateMisskeyNote = (candidate: unknown): MisskeyNote => {
  if (!isRecord(candidate) || !isRecord(candidate.user)) {
    throw new TypeError("Misskey returned an invalid note");
  }
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.user.username !== "string" ||
    !Array.isArray(candidate.files)
  ) {
    throw new TypeError("Misskey returned an invalid note");
  }
  return candidate as unknown as MisskeyNote;
};

export const fetchMisskeyNote = async (
  reference: MisskeyPostReference,
  getter: MisskeyPublicNoteGetter | undefined = getDefaultNoteGetter(),
): Promise<MisskeyNote> => {
  if (!getter) {
    throw new Error("Misskey Public API Bridge is not installed or loaded");
  }
  return validateMisskeyNote(await getter(reference.canonicalURL.href));
};

const authorHandle = (note: MisskeyNote, url: Readonly<URL>): string =>
  `${note.user.username}@${note.user.host || url.hostname}`;

const mediaFromNote = (note: MisskeyNote): FediverseMedia[] =>
  note.files.flatMap((file) => {
    try {
      const type = file.type.startsWith("image/")
        ? "image"
        : file.type.startsWith("video/")
        ? "video"
        : file.type.startsWith("audio/")
        ? "audio"
        : "unknown";
      return [
        {
          type,
          url: new URL(file.url),
          ...(file.comment ? { description: file.comment } : {}),
        } satisfies FediverseMedia,
      ];
    } catch (_error) {
      return [];
    }
  });

const renoteURL = (
  note: MisskeyNote,
  postURL: Readonly<URL>,
): string | undefined => {
  if (!note.renote) return undefined;
  if (typeof note.renote.uri === "string") {
    try {
      return new URL(note.renote.uri).href;
    } catch (_error) {
      // Fall back to a local note URL below.
    }
  }
  return typeof note.renote.id === "string"
    ? new URL(`/notes/${encodeURIComponent(note.renote.id)}`, postURL.origin)
      .href
    : undefined;
};

export interface FormatMisskeyPostOptions extends FormatFediverseMediaOptions {
  getNote?: MisskeyPublicNoteGetter;
}

export const stringifyMisskeyNote = async (
  note: MisskeyNote,
  postURL: Readonly<URL>,
  options: FormatFediverseMediaOptions = {},
): Promise<string> => {
  const lines = [
    `[@${escapeForEmbed(authorHandle(note, postURL))} ${postURL.href}]`,
  ];
  if (note.cw) lines.push(`CW: ${escapeForEmbed(note.cw)}`);
  if (note.text) {
    lines.push(...note.text.split("\n").map(escapeForEmbed));
  }
  const quotedURL = renoteURL(note, postURL);
  if (quotedURL) lines.push(`${note.text ? "Quote" : "Renote"}: ${quotedURL}`);
  lines.push(
    ...await formatFediverseMedia(mediaFromNote(note), postURL, options),
  );
  while (lines.at(-1)?.trim() === "") lines.pop();
  return lines.map((line) => `> ${line}`).join("\n");
};

export const formatMisskeyPost = (
  options: FormatMisskeyPostOptions = {},
): Middleware =>
(url) => {
  const reference = parseMisskeyPostURL(url);
  if (!reference) return new URL(url);
  return fetchMisskeyNote(reference, options.getNote).then((note) =>
    stringifyMisskeyNote(note, reference.canonicalURL, options)
  );
};
