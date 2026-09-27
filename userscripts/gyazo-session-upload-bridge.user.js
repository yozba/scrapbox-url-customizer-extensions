// ==UserScript==
// @name         Cosense Gyazo Session Upload Bridge
// @namespace    https://github.com/yozba/scrapbox-url-customizer-extensions
// @version      0.1.0
// @description  Uploads one MP4 to a fixed Gyazo endpoint using the browser's Gyazo session.
// @author       yozba
// @match        https://scrapbox.io/*
// @connect      gif.gyazo.com
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @noframes
// @run-at       document-start
// @downloadURL  https://raw.githubusercontent.com/yozba/scrapbox-url-customizer-extensions/authenticated-media/userscripts/gyazo-session-upload-bridge.user.js
// @updateURL    https://raw.githubusercontent.com/yozba/scrapbox-url-customizer-extensions/authenticated-media/userscripts/gyazo-session-upload-bridge.user.js
// @license      MIT
// ==/UserScript==

(() => {
  "use strict";

  const MAX_VIDEO_BYTES = 256 * 1024 * 1024;

  const uploadVideo = (video, title = "video.mp4") => {
    if (
      !video || typeof video.arrayBuffer !== "function" ||
      !Number.isFinite(video.size)
    ) {
      return Promise.reject(
        new TypeError("Gyazo upload requires a video file"),
      );
    }
    if (video.size <= 0 || video.size > MAX_VIDEO_BYTES) {
      return Promise.reject(
        new RangeError("Gyazo video must be between 1 byte and 256 MiB"),
      );
    }
    const type = String(video.type || "video/mp4").split(";")[0].toLowerCase();
    if (type !== "video/mp4") {
      return Promise.reject(
        new TypeError("Gyazo session upload only accepts MP4 video"),
      );
    }
    const safeTitle = String(title).slice(0, 300) || "video.mp4";
    const form = new FormData();
    form.append("data", video, safeTitle);
    form.append("metadata", JSON.stringify({ app: "Gyazo", title: safeTitle }));

    return new Promise((resolve, reject) => {
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
        onload: (result) => {
          if (result.status < 200 || result.status >= 300) {
            reject(
              new Error(
                `Gyazo session video upload failed: ${result.status} ${result.statusText}`,
              ),
            );
            return;
          }
          try {
            const url = new URL(
              String(result.responseText ?? result.response).trim(),
            );
            if (
              url.protocol !== "https:" ||
              !/(?:^|\.)gyazo\.com$/i.test(url.hostname)
            ) {
              throw new TypeError();
            }
            resolve(url.href);
          } catch (_error) {
            reject(new TypeError("Gyazo returned an invalid upload URL"));
          }
        },
        onerror: () =>
          reject(new TypeError("Gyazo upload network request failed")),
        ontimeout: () => reject(new TypeError("Gyazo upload timed out")),
      });
    });
  };

  Object.defineProperty(unsafeWindow, "GM_Gyazo_uploadVideo", {
    configurable: false,
    writable: false,
    value: uploadVideo,
  });
})();
