import { type Fetcher, getDefaultFetcher } from "../bluesky/fetch_post.ts";
import { uploadBlueskyImage } from "../bluesky/upload_image.ts";
import {
  createVideoFileUploader,
  isVideoTooLargeToUpload,
  type VideoFileUploader,
} from "../media/upload_video.ts";

export type InstagramImageUploader = (
  sourceURL: Readonly<URL>,
  postURL: Readonly<URL>,
  description?: string,
) => Promise<URL>;

export type InstagramVideoUploader = InstagramImageUploader;

export const uploadInstagramImage: InstagramImageUploader = (
  sourceURL,
  postURL,
  description,
) =>
  uploadBlueskyImage(
    {
      thumb: sourceURL.href,
      fullsize: sourceURL.href,
      alt: description,
    },
    postURL,
  );

export interface InstagramVideoUploaderDependencies {
  fetcher?: Fetcher;
  uploadFile?: VideoFileUploader;
}

export const createInstagramVideoUploader = (
  dependencies: InstagramVideoUploaderDependencies = {},
): InstagramVideoUploader => {
  const fetcher = dependencies.fetcher ?? getDefaultFetcher();
  const uploadFile = dependencies.uploadFile ?? createVideoFileUploader();
  const cache = new Map<string, Promise<URL>>();

  return (sourceURL, postURL) => {
    const cached = cache.get(sourceURL.href);
    if (cached) return cached;
    const promise = (async (): Promise<URL> => {
      try {
        const response = await fetcher(sourceURL, { credentials: "omit" });
        if (!response.ok) {
          throw new Error(
            `Instagram video download failed: ${response.status} ${response.statusText}`,
          );
        }
        if (isVideoTooLargeToUpload(response)) return new URL(sourceURL);
        const blob = await response.blob();
        const file = new File([blob], "instagram-video.mp4", {
          type: blob.type.split(";")[0] || "video/mp4",
        });
        return await uploadFile(file, postURL);
      } catch (error) {
        console.error("Failed to host an Instagram video", error);
        return new URL(sourceURL);
      }
    })();
    cache.set(sourceURL.href, promise);
    return promise;
  };
};

export const uploadInstagramVideo: InstagramVideoUploader =
  createInstagramVideoUploader();
