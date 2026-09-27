import { type Fetcher, getDefaultFetcher } from "./fetch_post.ts";
import type { BlueskyPost, BlueskyVideoView } from "./types.ts";
import {
  createVideoFileUploader,
  type VideoFileUploaderDependencies,
} from "../media/upload_video.ts";

export type BlueskyVideoUploader = (
  video: BlueskyVideoView,
  post: BlueskyPost,
  postURL: Readonly<URL>,
) => Promise<URL>;

export interface BlueskyVideoUploaderDependencies
  extends VideoFileUploaderDependencies {
  /** Resolves DIDs and downloads the source MP4. */
  fetcher?: Fetcher;
}

interface DIDDocument {
  service?: Array<{
    id?: unknown;
    type?: unknown;
    serviceEndpoint?: unknown;
  }>;
}

const didDocumentURL = (did: string): URL => {
  if (did.startsWith("did:plc:")) {
    return new URL(`https://plc.directory/${did}`);
  }
  if (did.startsWith("did:web:")) {
    const parts = did.slice("did:web:".length).split(":").map((part) =>
      decodeURIComponent(part)
    );
    const host = parts.shift();
    if (!host) throw new TypeError(`Invalid did:web identifier: ${did}`);
    const url = new URL(`https://${host}`);
    url.pathname = parts.length === 0
      ? "/.well-known/did.json"
      : `/${parts.map(encodeURIComponent).join("/")}/did.json`;
    return url;
  }
  throw new TypeError(`Unsupported DID method: ${did}`);
};

/** Resolves the user's personal data server from their DID document. */
export const resolveBlueskyPDS = async (
  did: string,
  fetcher: Fetcher = getDefaultFetcher(),
): Promise<URL> => {
  const response = await fetcher(didDocumentURL(did));
  if (!response.ok) {
    throw new Error(
      `DID document request failed: ${response.status} ${response.statusText}`,
    );
  }
  const document = await response.json() as DIDDocument;
  const pds = document.service?.find((service) =>
    typeof service.id === "string" && service.id.endsWith("#atproto_pds") &&
    typeof service.serviceEndpoint === "string"
  );
  if (typeof pds?.serviceEndpoint !== "string") {
    throw new TypeError(`No AT Protocol PDS was found for ${did}`);
  }
  const endpoint = new URL(pds.serviceEndpoint);
  if (endpoint.protocol !== "https:") {
    throw new TypeError(`The PDS endpoint is not HTTPS: ${endpoint}`);
  }
  return endpoint;
};

/** Creates a cached Bluesky video downloader and host uploader. */
export const createBlueskyVideoUploader = (
  dependencies: BlueskyVideoUploaderDependencies = {},
): BlueskyVideoUploader => {
  const fetcher = dependencies.fetcher ?? getDefaultFetcher();
  const uploadFile = createVideoFileUploader(dependencies);
  const cache = new Map<string, Promise<URL>>();

  return (video, post, postURL) => {
    const key = `${post.author.did}/${video.cid}`;
    const cached = cache.get(key);
    if (cached) return cached;

    const promise = (async (): Promise<URL> => {
      let sourceMP4: URL | undefined;
      try {
        const pds = await resolveBlueskyPDS(post.author.did, fetcher);
        const blobURL = new URL("/xrpc/com.atproto.sync.getBlob", pds);
        blobURL.searchParams.set("did", post.author.did);
        blobURL.searchParams.set("cid", video.cid);
        sourceMP4 = blobURL;
        const response = await fetcher(blobURL);
        if (!response.ok) {
          throw new Error(
            `Bluesky video download failed: ${response.status} ${response.statusText}`,
          );
        }
        const blob = await response.blob();
        const file = new File([blob], video.alt || "bluesky-video.mp4", {
          type: blob.type.split(";")[0] || "video/mp4",
        });
        return await uploadFile(file, postURL);
      } catch (error) {
        console.error("Failed to host a Bluesky source video", error);
        return sourceMP4 ?? new URL(video.playlist);
      }
    })();
    cache.set(key, promise);
    return promise;
  };
};

/** Uploads Bluesky videos using Gyazo, then Cosense storage. */
export const uploadBlueskyVideo: BlueskyVideoUploader =
  createBlueskyVideoUploader();
