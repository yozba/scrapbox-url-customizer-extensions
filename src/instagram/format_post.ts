import {
  escapeForEmbed,
  type Middleware,
} from "../deps/scrapbox_url_customizer.ts";
import {
  fetchInstagramPost,
  type FetchInstagramPostOptions,
  parseInstagramPostURL,
} from "./fetch_post.ts";
import type {
  InstagramImageCandidate,
  InstagramMedia,
  InstagramMediaItem,
  InstagramPost,
} from "./types.ts";
import {
  type InstagramImageUploader,
  type InstagramVideoUploader,
  uploadInstagramImage,
  uploadInstagramVideo,
} from "./upload_media.ts";

const largest = (
  candidates: InstagramImageCandidate[] | undefined,
): InstagramImageCandidate | undefined =>
  candidates?.filter((candidate) => typeof candidate.url === "string").sort(
    (a, b) =>
      (b.width ?? 0) * (b.height ?? 0) -
      (a.width ?? 0) * (a.height ?? 0),
  )[0];

const mediaFromItem = (item: InstagramMediaItem): InstagramMedia[] => {
  if (Array.isArray(item.carousel_media)) {
    return item.carousel_media.flatMap(mediaFromItem);
  }
  const video = largest(item.video_versions);
  if (video) return [{ type: "video", url: new URL(video.url) }];
  const image = largest(item.image_versions2?.candidates);
  return image ? [{ type: "image", url: new URL(image.url) }] : [];
};

export const extractInstagramMedia = (
  post: InstagramPost,
): InstagramMedia[] => {
  const authenticated = post.authenticated
    ? mediaFromItem(post.authenticated)
    : [];
  if (authenticated.length > 0) return authenticated;
  return post.oembed.thumbnail_url
    ? [{ type: "image", url: new URL(post.oembed.thumbnail_url) }]
    : [];
};

const compactImageURL = (url: Readonly<URL>): string => {
  const value = new URL(url);
  if (/(?:^|\.)gyazo\.com$/i.test(value.hostname)) return value.href;
  if (
    !/(?:\.(?:avif|gif|jpe?g|png|svg|webp)|@(?:avif|gif|jpe?g|png|webp))$/i
      .test(value.pathname) && !value.hash
  ) {
    value.hash = ".jpg";
  }
  return value.href;
};

export interface StringifyInstagramPostOptions {
  uploadImage?: InstagramImageUploader;
  uploadVideo?: InstagramVideoUploader;
}

export const stringifyInstagramPost = async (
  post: InstagramPost,
  options: StringifyInstagramPostOptions = {},
): Promise<string> => {
  const uploadImage = options.uploadImage ?? uploadInstagramImage;
  const uploadVideo = options.uploadVideo ?? uploadInstagramVideo;
  const username = post.authenticated?.user?.username ??
    post.oembed.author_name ?? "Instagram";
  const caption = post.authenticated?.caption?.text ?? post.oembed.title ?? "";
  const lines = [
    `[@${escapeForEmbed(username)} ${post.reference.canonicalURL}]`,
  ];
  if (caption) {
    lines.push(...caption.split("\n").map(escapeForEmbed));
  }

  const media = extractInstagramMedia(post);
  const images = media.filter((item) => item.type === "image");
  if (images.length > 0) {
    const uploaded = await Promise.all(
      images.map((item) =>
        uploadImage(item.url, post.reference.canonicalURL, caption)
      ),
    );
    lines.push(
      uploaded.map((url) => `[${compactImageURL(url)}]`).join(""),
    );
  }
  for (const video of media.filter((item) => item.type === "video")) {
    const uploaded = await uploadVideo(
      video.url,
      post.reference.canonicalURL,
      caption,
    );
    lines.push(`[${uploaded}]`);
  }

  while (lines.at(-1)?.trim() === "") lines.pop();
  return lines.map((line) => `> ${line}`).join("\n");
};

export interface FormatInstagramPostOptions extends FetchInstagramPostOptions {
  uploadImage?: InstagramImageUploader;
  uploadVideo?: InstagramVideoUploader;
}

export const formatInstagramPost = (
  options: FormatInstagramPostOptions = {},
): Middleware =>
(url) => {
  const reference = parseInstagramPostURL(url);
  if (!reference) return new URL(url);
  return fetchInstagramPost(reference, options).then((post) =>
    stringifyInstagramPost(post, options)
  );
};
