// ==UserScript==
// @name         Cosense Instagram Auth Bridge
// @namespace    https://github.com/yozba/scrapbox-url-customizer-extensions
// @version      0.1.0
// @description  Exposes one cookie-isolated, read-only Instagram media lookup to Cosense.
// @author       yozba
// @match        https://scrapbox.io/*
// @connect      instagram.com
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @noframes
// @run-at       document-start
// @downloadURL  https://raw.githubusercontent.com/yozba/scrapbox-url-customizer-extensions/main/userscripts/instagram-auth-bridge.user.js
// @updateURL    https://raw.githubusercontent.com/yozba/scrapbox-url-customizer-extensions/main/userscripts/instagram-auth-bridge.user.js
// @license      MIT
// ==/UserScript==

(() => {
  "use strict";

  const APP_ID = "936619743392459";
  const MEDIA_ID_PATTERN = /^\d+(?:_\d+)?$/;

  const candidate = (value) => {
    if (!value || typeof value.url !== "string") return undefined;
    const url = new URL(value.url);
    if (url.protocol !== "https:") return undefined;
    return {
      url: url.href,
      ...(Number.isFinite(value.width) ? { width: value.width } : {}),
      ...(Number.isFinite(value.height) ? { height: value.height } : {}),
    };
  };

  const sanitizeItem = (item, depth = 0) => {
    if (!item || typeof item !== "object" || depth > 2) return undefined;
    const images = Array.isArray(item.image_versions2?.candidates)
      ? item.image_versions2.candidates.map(candidate).filter(Boolean)
      : [];
    const videos = Array.isArray(item.video_versions)
      ? item.video_versions.map(candidate).filter(Boolean)
      : [];
    const carousel = Array.isArray(item.carousel_media)
      ? item.carousel_media.map((child) => sanitizeItem(child, depth + 1))
        .filter(Boolean)
      : [];
    return {
      ...(Number.isFinite(item.media_type)
        ? { media_type: item.media_type }
        : {}),
      ...(typeof item.caption?.text === "string"
        ? { caption: { text: item.caption.text } }
        : {}),
      ...(typeof item.user?.username === "string"
        ? { user: { username: item.user.username } }
        : {}),
      ...(images.length > 0 ? { image_versions2: { candidates: images } } : {}),
      ...(videos.length > 0 ? { video_versions: videos } : {}),
      ...(carousel.length > 0 ? { carousel_media: carousel } : {}),
    };
  };

  const getMedia = (mediaId, postURL) => {
    if (typeof mediaId !== "string" || !MEDIA_ID_PATTERN.test(mediaId)) {
      return Promise.reject(new TypeError("Invalid Instagram media ID"));
    }
    let referer;
    try {
      referer = new URL(postURL);
      if (referer.hostname !== "www.instagram.com") throw new TypeError();
    } catch (_error) {
      return Promise.reject(new TypeError("Invalid Instagram post URL"));
    }

    const url = `https://www.instagram.com/api/v1/media/${
      encodeURIComponent(mediaId)
    }/info/`;
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        anonymous: false,
        responseType: "text",
        fetch: true,
        timeout: 30_000,
        headers: {
          Accept: "application/json",
          "X-IG-App-ID": APP_ID,
          "X-ASBD-ID": "129477",
          "X-Requested-With": "XMLHttpRequest",
          Referer: referer.href,
        },
        onload: (result) => {
          if ([401, 403, 404].includes(result.status)) {
            resolve(undefined);
            return;
          }
          if (result.status < 200 || result.status >= 300) {
            reject(
              new Error(
                `Instagram authenticated request failed: ${result.status} ${result.statusText}`,
              ),
            );
            return;
          }
          try {
            const payload = JSON.parse(
              String(result.responseText ?? result.response),
            );
            resolve(sanitizeItem(payload?.items?.[0]));
          } catch (_error) {
            reject(
              new TypeError("Instagram returned an invalid media response"),
            );
          }
        },
        onerror: () =>
          reject(new TypeError("Instagram network request failed")),
        ontimeout: () =>
          reject(new TypeError("Instagram network request timed out")),
      });
    });
  };

  Object.defineProperty(unsafeWindow, "GM_Instagram_getMedia", {
    configurable: false,
    writable: false,
    value: getMedia,
  });
})();
