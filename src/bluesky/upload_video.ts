import { getProject, uploadToGCS } from "../deps/cosense_std.ts";
import { type Fetcher, getDefaultFetcher } from "./fetch_post.ts";
import type { BlueskyPost, BlueskyVideoView } from "./types.ts";
import { getConnectedGyazoToken } from "./upload_image.ts";

declare const scrapbox: { Project: { name: string } };

export type BlueskyVideoUploader = (
  video: BlueskyVideoView,
  post: BlueskyPost,
  postURL: Readonly<URL>,
) => Promise<URL>;

export interface BlueskyVideoUploaderDependencies {
  /** Resolves DIDs, downloads the source MP4, and uploads it to Gyazo. */
  fetcher?: Fetcher;
  /** Sends an OAuth upload to Gyazo. Defaults to fetch. */
  upload?: Fetcher;
  /** Sends a browser-session upload as a fallback. Defaults to GM_fetch. */
  sessionUpload?: Fetcher;
  /** Retrieves the Gyazo OAuth token connected to Cosense. */
  getToken?: () => Promise<string | undefined>;
  /** Uploads to Cosense storage when Gyazo rejects the video. */
  fallbackUpload?: (file: File) => Promise<URL>;
}

interface DIDDocument {
  service?: Array<{
    id?: unknown;
    type?: unknown;
    serviceEndpoint?: unknown;
  }>;
}

let projectIdPromise: Promise<string> | undefined;

const getCurrentProjectId = (): Promise<string> => {
  projectIdPromise ??= (async () => {
    const result = await getProject(scrapbox.Project.name);
    if (!result.ok) {
      throw new Error("Failed to get the current Cosense project", {
        cause: result.err,
      });
    }
    return result.val.id;
  })();
  return projectIdPromise;
};

const uploadToCosenseStorage = async (file: File): Promise<URL> => {
  const result = await uploadToGCS(file, await getCurrentProjectId());
  if (!result.ok) {
    throw new Error("Failed to upload the video to Cosense storage", {
      cause: result.err,
    });
  }
  return new URL(result.val.embedUrl);
};

const responseError = async (
  label: string,
  response: Response,
): Promise<Error> => {
  const body = (await response.text().catch(() => "")).trim().slice(0, 500);
  return new Error(
    `${label}: ${response.status} ${response.statusText}${
      body ? `: ${body}` : ""
    }`,
  );
};

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

/** Creates a cached Bluesky-to-Gyazo video uploader. */
export const createBlueskyVideoUploader = (
  dependencies: BlueskyVideoUploaderDependencies = {},
): BlueskyVideoUploader => {
  const fetcher = dependencies.fetcher ?? getDefaultFetcher();
  const upload = dependencies.upload ?? globalThis.fetch.bind(globalThis);
  const sessionUpload = dependencies.sessionUpload ?? getDefaultFetcher();
  const getToken = dependencies.getToken ?? getConnectedGyazoToken;
  const fallbackUpload = dependencies.fallbackUpload ?? uploadToCosenseStorage;
  let tokenPromise: Promise<string | undefined> | undefined;
  const cache = new Map<string, Promise<URL>>();

  return (video, post, postURL) => {
    const key = `${post.author.did}/${video.cid}`;
    const cached = cache.get(key);
    if (cached) return cached;

    const promise = (async (): Promise<URL> => {
      let sourceMP4: URL | undefined;
      let file: File | undefined;
      try {
        const pds = await resolveBlueskyPDS(post.author.did, fetcher);
        const blobURL = new URL("/xrpc/com.atproto.sync.getBlob", pds);
        blobURL.searchParams.set("did", post.author.did);
        blobURL.searchParams.set("cid", video.cid);
        sourceMP4 = blobURL;
        const videoResponse = await fetcher(blobURL);
        if (!videoResponse.ok) {
          throw new Error(
            `Bluesky video download failed: ${videoResponse.status} ${videoResponse.statusText}`,
          );
        }
        const blob = await videoResponse.blob();
        file = new File([blob], video.alt || "bluesky-video.mp4", {
          type: blob.type.split(";")[0] || "video/mp4",
        });

        let token: string | undefined;
        try {
          tokenPromise ??= getToken();
          token = await tokenPromise;
        } catch (error) {
          console.warn(
            "Could not get the Gyazo OAuth token; trying the browser session.",
            error,
          );
        }
        if (token) {
          try {
            const form = new FormData();
            form.append("imagedata", file);
            form.append("referer_url", postURL.href);
            form.append("title", video.alt || file.name);
            if (video.alt) form.append("desc", video.alt);
            const uploadResponse = await upload(
              "https://upload.gyazo.com/api/upload",
              {
                method: "POST",
                mode: "cors",
                credentials: "omit",
                headers: { Authorization: `Bearer ${token}` },
                body: form,
              },
            );
            if (!uploadResponse.ok) {
              throw await responseError(
                "Gyazo OAuth video upload failed",
                uploadResponse,
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
            console.warn(
              "Gyazo OAuth video upload failed; trying the browser session.",
              error,
            );
          }
        }

        const form = new FormData();
        form.append("data", file);
        form.append(
          "metadata",
          JSON.stringify({
            app: "Gyazo",
            title: file.name,
          }),
        );
        const uploadResponse = await sessionUpload(
          "https://gif.gyazo.com/gif/upload",
          {
            method: "POST",
            body: form,
            credentials: "include",
            headers: {
              Origin: "https://gyazo.com",
              "sec-fetch-site": "same-site",
            },
            referrer: "https://gyazo.com/",
          },
        );
        if (!uploadResponse.ok) {
          throw await responseError(
            "Gyazo session video upload failed",
            uploadResponse,
          );
        }
        return new URL((await uploadResponse.text()).trim());
      } catch (error) {
        if (file) {
          console.warn(
            "Gyazo rejected the Bluesky video; uploading it to Cosense storage.",
            {
              error,
              size: file.size,
              type: file.type,
              source: sourceMP4?.href,
            },
          );
          try {
            return await fallbackUpload(file);
          } catch (fallbackError) {
            console.error(
              "Failed to upload a Bluesky video to Gyazo and Cosense storage",
              { error, fallbackError },
            );
          }
        } else {
          console.error("Failed to download a Bluesky source video", error);
        }
        return sourceMP4 ?? new URL(video.playlist);
      }
    })();
    cache.set(key, promise);
    return promise;
  };
};

/** Uploads Bluesky videos using the current Gyazo browser session. */
export const uploadBlueskyVideo: BlueskyVideoUploader =
  createBlueskyVideoUploader();
