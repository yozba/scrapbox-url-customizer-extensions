import { getProject, uploadToGCS } from "../deps/cosense_std.ts";
import { type Fetcher, getDefaultFetcher } from "../bluesky/fetch_post.ts";
import { getConnectedGyazoToken } from "../bluesky/upload_image.ts";

declare const scrapbox: { Project: { name: string } };

export type VideoFileUploader = (
  file: File,
  sourceURL: Readonly<URL>,
) => Promise<URL>;

export interface VideoFileUploaderDependencies {
  upload?: Fetcher;
  sessionUpload?: Fetcher;
  getToken?: () => Promise<string | undefined>;
  fallbackUpload?: (file: File) => Promise<URL>;
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

/** Uploads a video file to Gyazo, then Cosense storage as a fallback. */
export const createVideoFileUploader = (
  dependencies: VideoFileUploaderDependencies = {},
): VideoFileUploader => {
  const upload = dependencies.upload ?? globalThis.fetch.bind(globalThis);
  const sessionUpload = dependencies.sessionUpload ?? getDefaultFetcher();
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
        return new URL(permalink);
      } catch (error) {
        gyazoError = error;
        console.warn(
          "Gyazo OAuth video upload failed; trying the browser session.",
          error,
        );
      }
    }

    try {
      const form = new FormData();
      form.append("data", file);
      form.append(
        "metadata",
        JSON.stringify({ app: "Gyazo", title: file.name }),
      );
      const response = await sessionUpload(
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
      if (!response.ok) {
        throw await responseError(
          "Gyazo session video upload failed",
          response,
        );
      }
      return new URL((await response.text()).trim());
    } catch (error) {
      gyazoError = error;
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
