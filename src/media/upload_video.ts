import { getProject, uploadToGCS } from "../deps/cosense_std.ts";
import type { Fetcher } from "../bluesky/fetch_post.ts";
import { getConnectedGyazoToken } from "../bluesky/upload_image.ts";

declare const scrapbox: { Project: { name: string } };

export type VideoFileUploader = (
  file: File,
  sourceURL: Readonly<URL>,
) => Promise<URL>;

export type GyazoSessionVideoUploader = (
  file: File,
  title?: string,
) => Promise<string | URL>;

export type GyazoOAuthVideoUploader = (
  file: File,
  accessToken: string,
  sourceURL: string,
  title?: string,
) => Promise<string | URL>;

export interface VideoFileUploaderDependencies {
  upload?: Fetcher;
  oauthUpload?: GyazoOAuthVideoUploader;
  sessionUpload?: GyazoSessionVideoUploader;
  getToken?: () => Promise<string | undefined>;
  fallbackUpload?: (file: File) => Promise<URL>;
}

// Chrome extension messages are limited to 64 MiB. Leave headroom for the
// multipart envelope and Tampermonkey's serialization overhead.
export const MAX_SESSION_BRIDGE_BYTES = 60 * 1024 * 1024;

const getDefaultOAuthUploader = (): GyazoOAuthVideoUploader | undefined =>
  (globalThis as typeof globalThis & {
    GM_Gyazo_uploadVideoOAuth?: GyazoOAuthVideoUploader;
  }).GM_Gyazo_uploadVideoOAuth;

const getDefaultSessionUploader = (): GyazoSessionVideoUploader | undefined =>
  (globalThis as typeof globalThis & {
    GM_Gyazo_uploadVideo?: GyazoSessionVideoUploader;
  }).GM_Gyazo_uploadVideo;

const checkedUploadURL = (value: string | URL): URL => {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !/(?:^|\.)gyazo\.com$/i.test(url.hostname)
  ) {
    throw new TypeError("Gyazo returned an invalid upload URL");
  }
  return url;
};

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

/** Uploads a video file to Gyazo, then Cosense storage as a fallback. */
export const createVideoFileUploader = (
  dependencies: VideoFileUploaderDependencies = {},
): VideoFileUploader => {
  const upload = dependencies.upload ?? globalThis.fetch.bind(globalThis);
  const oauthUpload = dependencies.oauthUpload ?? getDefaultOAuthUploader();
  const sessionUpload = dependencies.sessionUpload ??
    getDefaultSessionUploader();
  const getToken = dependencies.getToken ?? getConnectedGyazoToken;
  const fallbackUpload = dependencies.fallbackUpload ?? uploadToCosenseStorage;
  let tokenPromise: Promise<string | undefined> | undefined;

  return async (file, sourceURL) => {
    let gyazoError: unknown;
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

    if (token && oauthUpload) {
      try {
        return checkedUploadURL(
          await oauthUpload(file, token, sourceURL.href, file.name),
        );
      } catch (error) {
        gyazoError = error;
        console.warn(
          "Gyazo form upload failed; trying the OAuth fetch fallback.",
          error,
        );
      }
    }

    if (token) {
      try {
        const form = new FormData();
        form.append("imagedata", file);
        form.append("referer_url", sourceURL.href);
        form.append("title", file.name);
        const response = await upload("https://upload.gyazo.com/api/upload", {
          method: "POST",
          mode: "cors",
          credentials: "omit",
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        });
        if (!response.ok) {
          throw await responseError(
            "Gyazo OAuth video upload failed",
            response,
          );
        }
        const result = await response.json() as {
          permalink_url?: unknown;
          url?: unknown;
        };
        const permalink = typeof result.permalink_url === "string"
          ? result.permalink_url
          : result.url;
        if (typeof permalink !== "string") {
          throw new TypeError("Gyazo returned an invalid upload response");
        }
        return checkedUploadURL(permalink);
      } catch (error) {
        gyazoError = error;
        console.warn(
          "Gyazo OAuth video upload failed; trying the browser session.",
          error,
        );
      }
    }

    if (sessionUpload && file.size <= MAX_SESSION_BRIDGE_BYTES) {
      try {
        return checkedUploadURL(await sessionUpload(file, file.name));
      } catch (error) {
        gyazoError = error;
      }
    } else if (sessionUpload) {
      gyazoError = new RangeError(
        "The video exceeds the 60 MiB browser-extension bridge limit",
      );
    } else if (!gyazoError) {
      gyazoError = new Error("Gyazo Upload Bridge is not installed");
    }

    console.warn(
      "Gyazo rejected the video; uploading it to Cosense storage.",
      {
        error: gyazoError,
        size: file.size,
        type: file.type,
        source: sourceURL.href,
      },
    );
    try {
      return await fallbackUpload(file);
    } catch (fallbackError) {
      throw new AggregateError(
        [gyazoError, fallbackError],
        "Failed to upload the video to Gyazo and Cosense storage",
      );
    }
  };
};

export const uploadVideoFile: VideoFileUploader = createVideoFileUploader();
