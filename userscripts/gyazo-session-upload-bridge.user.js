// ==UserScript==
// @name         Cosense Gyazo Upload Bridge
// @namespace    https://github.com/yozba/scrapbox-url-customizer-extensions
// @version      0.3.0
// @description  Uploads MP4 files to Gyazo without transferring them through extension messages.
// @author       yozba
// @match        https://scrapbox.io/*
// @connect      api.gyazo.com
// @connect      gif.gyazo.com
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @noframes
// @run-at       document-start
// @downloadURL  https://raw.githubusercontent.com/yozba/scrapbox-url-customizer-extensions/main/userscripts/gyazo-session-upload-bridge.user.js
// @updateURL    https://raw.githubusercontent.com/yozba/scrapbox-url-customizer-extensions/main/userscripts/gyazo-session-upload-bridge.user.js
// @license      MIT
// ==/UserScript==

(() => {
  "use strict";

  const MAX_VIDEO_BYTES = 256 * 1024 * 1024;
  const MAX_EXTENSION_MESSAGE_BYTES = 60 * 1024 * 1024;
  const OAUTH_UPLOAD_TIMEOUT_MS = 15 * 60_000;
  const CAPTURE_LOOKUP_TIMEOUT_MS = 60_000;
  const SESSION_UPLOAD_TIMEOUT_MS = 130_000;
  const nativeFetch = globalThis.fetch.bind(globalThis);

  const asGyazoURL = (value) => {
    const url = new URL(value);
    if (
      !/^https?:$/.test(url.protocol) ||
      !/(?:^|\.)gyazo\.com$/i.test(url.hostname)
    ) {
      throw new TypeError("Gyazo returned an invalid upload URL");
    }
    url.protocol = "https:";
    return url.href;
  };

  if (location.hostname !== "scrapbox.io") return;

  const getGyazoCaptures = (accessToken) =>
    new Promise((resolve, reject) => {
      try {
        GM_xmlhttpRequest({
          method: "GET",
          url: "https://api.gyazo.com/api/images?page=1&per_page=100",
          anonymous: true,
          responseType: "json",
          timeout: 15_000,
          headers: { Authorization: `Bearer ${accessToken}` },
          onload: (result) => {
            try {
              if (result.status < 200 || result.status >= 300) {
                throw new Error(
                  `Gyazo capture lookup failed: ${result.status} ${result.statusText}`,
                );
              }
              const captures = typeof result.response === "string"
                ? JSON.parse(result.response)
                : result.response;
              if (!Array.isArray(captures)) {
                throw new TypeError("Gyazo returned an invalid capture list");
              }
              resolve(captures);
            } catch (error) {
              reject(error);
            }
          },
          onerror: () =>
            reject(new TypeError("Gyazo capture lookup request failed")),
          ontimeout: () =>
            reject(new TypeError("Gyazo capture lookup timed out")),
        });
      } catch (error) {
        reject(error);
      }
    });

  const findNewCapture = (captures, previousIds, sourceURL, title) => {
    const newCaptures = captures.filter((capture) =>
      typeof capture?.image_id === "string" &&
      !previousIds.has(capture.image_id)
    );
    const capture =
      newCaptures.find((item) =>
        item.metadata?.url === sourceURL || item.metadata?.title === title
      ) ?? (newCaptures.length === 1 ? newCaptures[0] : undefined);
    const value = typeof capture?.permalink_url === "string"
      ? capture.permalink_url
      : capture?.url;
    return typeof value === "string" ? asGyazoURL(value) : undefined;
  };

  const waitForNewCapture = async (
    accessToken,
    previousIds,
    sourceURL,
    title,
  ) => {
    const deadline = Date.now() + CAPTURE_LOOKUP_TIMEOUT_MS;
    let lastError;
    do {
      try {
        const url = findNewCapture(
          await getGyazoCaptures(accessToken),
          previousIds,
          sourceURL,
          title,
        );
        if (url) return url;
      } catch (error) {
        lastError = error;
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    } while (Date.now() < deadline);
    throw new Error("Gyazo uploaded the video but its URL was not found", {
      cause: lastError,
    });
  };

  const validateVideo = (video) => {
    if (
      !video || typeof video.arrayBuffer !== "function" ||
      !Number.isFinite(video.size)
    ) {
      throw new TypeError("Gyazo upload requires a video file");
    }
    if (video.size <= 0 || video.size > MAX_VIDEO_BYTES) {
      throw new RangeError("Gyazo video must be between 1 byte and 256 MiB");
    }
    const type = String(video.type || "video/mp4").split(";")[0].toLowerCase();
    if (type !== "video/mp4") {
      throw new TypeError("Gyazo upload only accepts MP4 video");
    }
  };

  const uploadVideoOAuth = async (
    video,
    accessToken,
    sourceURL,
    title = "video.mp4",
  ) => {
    validateVideo(video);
    if (typeof accessToken !== "string" || !accessToken) {
      throw new TypeError("Gyazo OAuth upload requires an access token");
    }
    const referer = new URL(sourceURL);
    if (!/^https?:$/.test(referer.protocol)) {
      throw new TypeError("Gyazo upload requires an HTTP source URL");
    }
    const safeTitle = String(title).slice(0, 300) || "video.mp4";
    const previousCaptures = await getGyazoCaptures(accessToken);
    const previousIds = new Set(
      previousCaptures.flatMap((capture) =>
        typeof capture?.image_id === "string" ? [capture.image_id] : []
      ),
    );
    const form = new FormData();
    form.append("data", video, safeTitle);
    form.append(
      "metadata",
      JSON.stringify({
        app: "Gyazo",
        title: safeTitle,
        url: sourceURL,
      }),
    );
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      OAUTH_UPLOAD_TIMEOUT_MS,
    );
    try {
      // This is the same session endpoint used by Gyazo's D&D upload. Keeping
      // the request in no-cors mode avoids response CORS while the browser
      // streams the File directly, outside extension messaging.
      await nativeFetch("https://gif.gyazo.com/gif/upload", {
        method: "POST",
        mode: "no-cors",
        credentials: "include",
        body: form,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    return await waitForNewCapture(
      accessToken,
      previousIds,
      sourceURL,
      safeTitle,
    );
  };

  const uploadVideoSession = (video, title = "video.mp4") => {
    try {
      validateVideo(video);
      if (video.size > MAX_EXTENSION_MESSAGE_BYTES) {
        throw new RangeError(
          "Gyazo session upload cannot pass videos over 60 MiB through Chrome extension messaging",
        );
      }
    } catch (error) {
      return Promise.reject(error);
    }

    const safeTitle = String(title).slice(0, 300) || "video.mp4";
    const form = new FormData();
    form.append("data", video, safeTitle);
    form.append("metadata", JSON.stringify({ app: "Gyazo", title: safeTitle }));

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callback();
      };
      const timer = setTimeout(
        () => finish(() => reject(new TypeError("Gyazo upload timed out"))),
        SESSION_UPLOAD_TIMEOUT_MS,
      );

      try {
        GM_xmlhttpRequest({
          method: "POST",
          url: "https://gif.gyazo.com/gif/upload",
          anonymous: false,
          data: form,
          responseType: "text",
          fetch: true,
          timeout: 120_000,
          headers: {
            Origin: "https://gyazo.com",
            "sec-fetch-site": "same-site",
            Referer: "https://gyazo.com/",
          },
          onload: (result) =>
            finish(() => {
              if (result.status < 200 || result.status >= 300) {
                reject(
                  new Error(
                    `Gyazo session video upload failed: ${result.status} ${result.statusText}`,
                  ),
                );
                return;
              }
              try {
                resolve(
                  asGyazoURL(
                    String(result.responseText ?? result.response).trim(),
                  ),
                );
              } catch (error) {
                reject(error);
              }
            }),
          onerror: () =>
            finish(() =>
              reject(new TypeError("Gyazo upload network request failed"))
            ),
          ontimeout: () =>
            finish(() => reject(new TypeError("Gyazo upload timed out"))),
        });
      } catch (error) {
        finish(() => reject(error));
      }
    });
  };

  Object.defineProperties(unsafeWindow, {
    GM_Gyazo_uploadVideoOAuth: {
      configurable: false,
      writable: false,
      value: uploadVideoOAuth,
    },
    GM_Gyazo_uploadVideo: {
      configurable: false,
      writable: false,
      value: uploadVideoSession,
    },
  });
})();
