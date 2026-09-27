// ==UserScript==
// @name         Cosense Gyazo Upload Bridge
// @namespace    https://github.com/yozba/scrapbox-url-customizer-extensions
// @version      0.2.0
// @description  Uploads MP4 files to Gyazo without transferring them through extension messages.
// @author       yozba
// @match        https://scrapbox.io/*
// @match        https://upload.gyazo.com/api/upload*
// @connect      gif.gyazo.com
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @run-at       document-start
// @downloadURL  https://raw.githubusercontent.com/yozba/scrapbox-url-customizer-extensions/main/userscripts/gyazo-session-upload-bridge.user.js
// @updateURL    https://raw.githubusercontent.com/yozba/scrapbox-url-customizer-extensions/main/userscripts/gyazo-session-upload-bridge.user.js
// @license      MIT
// ==/UserScript==

(() => {
  "use strict";

  const CHANNEL = "cosense-gyazo-upload-bridge-v1";
  const FRAME_PREFIX = "cosense-gyazo-upload-";
  const MAX_VIDEO_BYTES = 256 * 1024 * 1024;
  const MAX_EXTENSION_MESSAGE_BYTES = 60 * 1024 * 1024;
  const OAUTH_UPLOAD_TIMEOUT_MS = 5 * 60_000;
  const SESSION_UPLOAD_TIMEOUT_MS = 130_000;
  const submitForm = HTMLFormElement.prototype.submit;

  const asGyazoURL = (value) => {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !/(?:^|\.)gyazo\.com$/i.test(url.hostname)
    ) {
      throw new TypeError("Gyazo returned an invalid upload URL");
    }
    return url.href;
  };

  const relayOAuthResponse = () => {
    const requestId = new URLSearchParams(location.hash.slice(1)).get(
      "cosense_bridge",
    );
    if (globalThis === globalThis.top || !requestId) return;
    const send = () => {
      const body = document.body?.textContent?.trim() ?? "";
      try {
        const result = JSON.parse(body);
        const value = typeof result.permalink_url === "string"
          ? result.permalink_url
          : result.url;
        globalThis.parent.postMessage(
          { channel: CHANNEL, requestId, ok: true, url: asGyazoURL(value) },
          "https://scrapbox.io",
        );
      } catch (_error) {
        globalThis.parent.postMessage(
          {
            channel: CHANNEL,
            requestId,
            ok: false,
            error: body.slice(0, 500) || "Gyazo returned an invalid response",
          },
          "https://scrapbox.io",
        );
      }
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", send, { once: true });
    } else {
      queueMicrotask(send);
    }
  };

  if (location.hostname === "upload.gyazo.com") {
    relayOAuthResponse();
    return;
  }
  if (location.hostname !== "scrapbox.io") return;

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

  const hiddenField = (name, value) => {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    return input;
  };

  const uploadVideoOAuth = (
    video,
    accessToken,
    sourceURL,
    title = "video.mp4",
  ) => {
    try {
      validateVideo(video);
      if (typeof accessToken !== "string" || !accessToken) {
        throw new TypeError("Gyazo OAuth upload requires an access token");
      }
      const referer = new URL(sourceURL);
      if (!/^https?:$/.test(referer.protocol)) {
        throw new TypeError("Gyazo upload requires an HTTP source URL");
      }
    } catch (error) {
      return Promise.reject(error);
    }

    const requestId = crypto.randomUUID();
    const target = `${FRAME_PREFIX}${requestId}`;
    const safeTitle = String(title).slice(0, 300) || "video.mp4";
    const iframe = document.createElement("iframe");
    iframe.name = target;
    iframe.hidden = true;
    iframe.setAttribute("aria-hidden", "true");

    const form = document.createElement("form");
    form.method = "POST";
    form.enctype = "multipart/form-data";
    form.action =
      `https://upload.gyazo.com/api/upload#cosense_bridge=${requestId}`;
    form.target = target;
    form.hidden = true;
    const tokenField = hiddenField("access_token", accessToken);
    form.append(tokenField);
    form.append(hiddenField("referer_url", sourceURL));
    form.append(hiddenField("title", safeTitle));

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.name = "imagedata";
    const transfer = new DataTransfer();
    transfer.items.add(video);
    fileInput.files = transfer.files;
    form.append(fileInput);

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        globalThis.removeEventListener("message", onMessage);
        tokenField.value = "";
        form.remove();
        iframe.remove();
      };
      const onMessage = (event) => {
        if (
          event.origin !== "https://upload.gyazo.com" ||
          event.source !== iframe.contentWindow ||
          event.data?.channel !== CHANNEL ||
          event.data?.requestId !== requestId
        ) {
          return;
        }
        cleanup();
        if (event.data.ok) {
          try {
            resolve(asGyazoURL(event.data.url));
          } catch (error) {
            reject(error);
          }
        } else {
          reject(
            new Error(`Gyazo OAuth form upload failed: ${event.data.error}`),
          );
        }
      };

      const timer = setTimeout(() => {
        cleanup();
        reject(new TypeError("Gyazo OAuth form upload timed out"));
      }, OAUTH_UPLOAD_TIMEOUT_MS);
      globalThis.addEventListener("message", onMessage);
      document.documentElement.append(iframe, form);
      try {
        submitForm.call(form);
        tokenField.value = "";
        form.remove();
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
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
