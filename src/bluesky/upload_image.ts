import { getGyazoToken } from "../deps/cosense_std.ts";
import { type Fetcher, getDefaultFetcher } from "./fetch_post.ts";
import type { BlueskyImageView } from "./types.ts";

export type BlueskyImageUploader = (
  image: BlueskyImageView,
  postURL: Readonly<URL>,
) => Promise<URL>;

export interface BlueskyImageUploaderDependencies {
  /** Downloads the original image. Defaults to GM_fetch, then fetch. */
  download?: Fetcher;
  /** Sends the multipart upload to Gyazo. Defaults to fetch. */
  upload?: Fetcher;
  /** Retrieves the Gyazo OAuth token connected to Cosense. */
  getToken?: () => Promise<string | undefined>;
}

export const getConnectedGyazoToken = async (): Promise<
  string | undefined
> => {
  const result = await getGyazoToken();
  if (!result.ok) {
    throw new Error("Failed to get the Gyazo upload token", {
      cause: result.err,
    });
  }
  return result.val;
};

const extensionFor = (blob: Blob): string => {
  const subtype = blob.type.split("/")[1]?.split(";")[0]?.toLowerCase();
  if (!subtype) return "jpg";
  return subtype === "jpeg" ? "jpg" : subtype.replace(/[^a-z0-9.+-]/g, "");
};

/** Creates a cached Bluesky-to-Gyazo image uploader. */
export const createBlueskyImageUploader = (
  dependencies: BlueskyImageUploaderDependencies = {},
): BlueskyImageUploader => {
  const download = dependencies.download ?? getDefaultFetcher();
  const upload = dependencies.upload ?? globalThis.fetch.bind(globalThis);
  const getToken = dependencies.getToken ?? getConnectedGyazoToken;
  let tokenPromise: Promise<string | undefined> | undefined;
  const cache = new Map<string, Promise<URL>>();

  return (image, postURL) => {
    const cached = cache.get(image.fullsize);
    if (cached) return cached;

    const promise = (async (): Promise<URL> => {
      try {
        tokenPromise ??= getToken();
        const token = await tokenPromise;
        if (!token) {
          console.warn(
            "Gyazo is not connected to Cosense; using the Bluesky image URL.",
          );
          return new URL(image.fullsize);
        }

        const imageResponse = await download(new URL(image.fullsize), {
          credentials: "omit",
        });
        if (!imageResponse.ok) {
          throw new Error(
            `Bluesky image download failed: ${imageResponse.status} ${imageResponse.statusText}`,
          );
        }
        const blob = await imageResponse.blob();
        const form = new FormData();
        form.append(
          "imagedata",
          blob,
          `bluesky-image.${extensionFor(blob)}`,
        );
        form.append("access_token", token);
        form.append("referer_url", postURL.href);
        if (image.alt) form.append("desc", image.alt);

        const uploadResponse = await upload(
          "https://upload.gyazo.com/api/upload",
          {
            method: "POST",
            mode: "cors",
            credentials: "omit",
            body: form,
          },
        );
        if (!uploadResponse.ok) {
          throw new Error(
            `Gyazo upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`,
          );
        }
        const result = await uploadResponse.json() as {
          permalink_url?: unknown;
          url?: unknown;
        };
        const permalink = typeof result.permalink_url === "string"
          ? result.permalink_url
          : result.url;
        if (typeof permalink !== "string") {
          throw new TypeError("Gyazo returned an invalid upload response");
        }
        return new URL(permalink);
      } catch (error) {
        console.error("Failed to upload a Bluesky image to Gyazo", error);
        return new URL(image.fullsize);
      }
    })();
    cache.set(image.fullsize, promise);
    return promise;
  };
};

/** Uploads Bluesky images using the Gyazo account connected to Cosense. */
export const uploadBlueskyImage: BlueskyImageUploader =
  createBlueskyImageUploader();
