import type { Media } from "../deps/scrapbox_url_customizer.ts";
import { type Fetcher, getDefaultFetcher } from "../bluesky/fetch_post.ts";
import {
  type BlueskyImageUploader,
  uploadBlueskyImage,
} from "../bluesky/upload_image.ts";
import {
  isVideoTooLargeToUpload,
  uploadVideoFile,
  type VideoFileUploader,
} from "../media/upload_video.ts";

export type XMediaUploader = (
  media: Media,
  tweetURL: Readonly<URL>,
) => Promise<URL>;

export interface XMediaUploaderDependencies {
  fetcher?: Fetcher;
  uploadImage?: BlueskyImageUploader;
  uploadVideo?: VideoFileUploader;
}

/** Uploads X media without granting the generic fetch bridge any credentials. */
export const createXMediaUploader = (
  dependencies: XMediaUploaderDependencies = {},
): XMediaUploader => {
  const fetcher = dependencies.fetcher ?? getDefaultFetcher();
  const uploadImage = dependencies.uploadImage ?? uploadBlueskyImage;
  const uploadVideo = dependencies.uploadVideo ?? uploadVideoFile;
  const cache = new Map<string, Promise<URL>>();

  return (media, tweetURL) => {
    const cached = cache.get(media.url.href);
    if (cached) return cached;

    const promise = (async () => {
      if (media.type === "photo") {
        if (media.url.hostname !== "pbs.twimg.com") return media.url;
        return await uploadImage(
          { thumb: media.url.href, fullsize: media.url.href },
          tweetURL,
        );
      }
      if (media.url.hostname !== "video.twimg.com") return media.url;

      try {
        const response = await fetcher(media.url, { credentials: "omit" });
        if (!response.ok) {
          throw new Error(
            `X video download failed: ${response.status} ${response.statusText}`,
          );
        }
        if (isVideoTooLargeToUpload(response)) return media.url;
        const blob = await response.blob();
        const type = blob.type.split(";")[0] || "video/mp4";
        if (type !== "video/mp4") {
          throw new TypeError(`Unsupported X video type: ${type}`);
        }
        const file = new File([blob], "x-video.mp4", { type });
        return await uploadVideo(file, tweetURL);
      } catch (error) {
        console.error("Failed to host an X video", error);
        return media.url;
      }
    })();
    cache.set(media.url.href, promise);
    return promise;
  };
};

export const uploadXMedia: XMediaUploader = createXMediaUploader();
