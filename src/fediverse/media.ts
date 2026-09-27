import type { BlueskyImageView } from "../bluesky/types.ts";
import {
  type BlueskyImageUploader,
  uploadBlueskyImage,
} from "../bluesky/upload_image.ts";
import {
  type InstagramVideoUploader,
  uploadInstagramVideo,
} from "../instagram/upload_media.ts";

export type FediverseMediaType = "image" | "video" | "audio" | "unknown";

export interface FediverseMedia {
  type: FediverseMediaType;
  url: URL;
  description?: string;
}

export interface FormatFediverseMediaOptions {
  uploadImage?: BlueskyImageUploader;
  uploadVideo?: InstagramVideoUploader;
}

const asCosenseImageURL = (source: Readonly<URL>): string => {
  const url = new URL(source);
  if (/(?:^|\.)gyazo\.com$/i.test(url.hostname)) return url.href;
  if (
    !/(?:\.(?:avif|gif|jpe?g|png|svg|webp)|@(?:avif|gif|jpe?g|png|webp))$/i
      .test(url.pathname) && !url.hash
  ) {
    url.hash = ".jpg";
  }
  return url.href;
};

/** Uploads supported Fediverse media and returns Cosense embed lines. */
export const formatFediverseMedia = async (
  media: readonly FediverseMedia[],
  postURL: Readonly<URL>,
  options: FormatFediverseMediaOptions = {},
): Promise<string[]> => {
  const uploadImage = options.uploadImage ?? uploadBlueskyImage;
  const uploadVideo = options.uploadVideo ?? uploadInstagramVideo;
  const lines: string[] = [];
  const images = media.filter((item) => item.type === "image");

  if (images.length > 0) {
    const uploaded = await Promise.all(
      images.map((item) => {
        const image: BlueskyImageView = {
          thumb: item.url.href,
          fullsize: item.url.href,
          ...(item.description ? { alt: item.description } : {}),
        };
        return uploadImage(image, postURL);
      }),
    );
    lines.push(
      uploaded.map((url) => `[${asCosenseImageURL(url)}]`).join(""),
    );
  }

  for (const item of media) {
    if (item.type === "video") {
      lines.push(`[${await uploadVideo(item.url, postURL, item.description)}]`);
    } else if (item.type === "audio" || item.type === "unknown") {
      lines.push(`[${item.url.href}]`);
    }
  }

  return lines;
};
