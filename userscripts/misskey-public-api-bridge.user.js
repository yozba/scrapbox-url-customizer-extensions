// ==UserScript==
// @name         Cosense Misskey Public API Bridge
// @namespace    https://github.com/yozba/scrapbox-url-customizer-extensions
// @version      0.1.0
// @description  Exposes one anonymous, read-only Misskey note lookup to Cosense.
// @author       yozba
// @match        https://scrapbox.io/*
// @connect      *
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @noframes
// @run-at       document-start
// @downloadURL  https://raw.githubusercontent.com/yozba/scrapbox-url-customizer-extensions/main/userscripts/misskey-public-api-bridge.user.js
// @updateURL    https://raw.githubusercontent.com/yozba/scrapbox-url-customizer-extensions/main/userscripts/misskey-public-api-bridge.user.js
// @license      MIT
// ==/UserScript==

(() => {
  "use strict";

  const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
  const TIMEOUT_MS = 30_000;
  const NOTE_PATH = /^\/notes\/([A-Za-z0-9_-]{1,128})\/?$/;

  const isPrivateIPv4 = (hostname) => {
    const parts = hostname.split(".");
    if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) {
      return false;
    }
    const octets = parts.map(Number);
    if (octets.some((octet) => octet > 255)) return true;
    const [a, b] = octets;
    return a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) || a >= 224;
  };

  const isPrivateIPv6 = (hostname) => {
    const value = hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (!value.includes(":")) return false;
    if (value === "::" || value === "::1") return true;
    if (/^(?:fc|fd)/.test(value) || /^fe[89ab]/.test(value)) return true;
    const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateIPv4(mapped[1]) : false;
  };

  const checkedPost = (input) => {
    const url = new URL(input);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username || url.password
    ) {
      throw new TypeError("Invalid Misskey post URL");
    }
    const hostname = url.hostname.toLowerCase();
    if (
      hostname === "localhost" || hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") || hostname.endsWith(".internal") ||
      hostname.endsWith(".lan") || isPrivateIPv4(hostname) ||
      isPrivateIPv6(hostname)
    ) {
      throw new TypeError("Misskey bridge does not access private hosts");
    }
    const match = url.pathname.match(NOTE_PATH);
    if (!match) throw new TypeError("Invalid Misskey note URL");
    const endpoint = new URL("/api/notes/show", url.origin);
    return { endpoint, noteId: match[1] };
  };

  const safeURL = (value) => {
    if (typeof value !== "string") return undefined;
    try {
      const url = new URL(value);
      return url.protocol === "https:" || url.protocol === "http:"
        ? url.href
        : undefined;
    } catch (_error) {
      return undefined;
    }
  };

  const sanitizeNote = (note, expectedId) => {
    if (
      !note || typeof note !== "object" || note.id !== expectedId ||
      typeof note.user?.username !== "string"
    ) {
      throw new TypeError("Misskey returned an invalid note");
    }
    const files = Array.isArray(note.files)
      ? note.files.slice(0, 32).flatMap((file) => {
        const url = safeURL(file?.url);
        if (!url || typeof file?.type !== "string") return [];
        return [{
          type: file.type,
          url,
          ...(typeof file.comment === "string"
            ? { comment: file.comment }
            : {}),
        }];
      })
      : [];
    const renote = note.renote && typeof note.renote === "object"
      ? {
        ...(typeof note.renote.id === "string" ? { id: note.renote.id } : {}),
        ...(safeURL(note.renote.uri) ? { uri: safeURL(note.renote.uri) } : {}),
      }
      : undefined;
    return {
      id: note.id,
      ...(typeof note.text === "string" || note.text === null
        ? { text: note.text }
        : {}),
      ...(typeof note.cw === "string" || note.cw === null
        ? { cw: note.cw }
        : {}),
      user: {
        username: note.user.username,
        ...(typeof note.user.host === "string" || note.user.host === null
          ? { host: note.user.host }
          : {}),
      },
      files,
      ...(renote ? { renote } : {}),
    };
  };

  const getNote = (postURL) => {
    let target;
    try {
      target = checkedPost(postURL);
    } catch (error) {
      return Promise.reject(error);
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      const control = GM_xmlhttpRequest({
        method: "POST",
        url: target.endpoint.href,
        anonymous: true,
        responseType: "text",
        redirect: "manual",
        fetch: true,
        timeout: TIMEOUT_MS,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        data: JSON.stringify({ noteId: target.noteId }),
        onprogress: (event) => {
          if (event.loaded > MAX_RESPONSE_BYTES) {
            control?.abort();
            fail(new RangeError("Misskey response exceeded 8 MiB"));
          }
        },
        onload: (result) => {
          if (settled) return;
          try {
            const finalURL = new URL(result.finalUrl || target.endpoint.href);
            if (finalURL.href !== target.endpoint.href) {
              throw new TypeError("Misskey request changed its destination");
            }
            if (result.status < 200 || result.status >= 300) {
              throw new Error(
                `Misskey request failed: ${result.status} ${result.statusText}`,
              );
            }
            const text = String(result.responseText ?? result.response ?? "");
            if (
              new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES
            ) {
              throw new RangeError("Misskey response exceeded 8 MiB");
            }
            const note = sanitizeNote(JSON.parse(text), target.noteId);
            settled = true;
            resolve(note);
          } catch (error) {
            fail(error);
          }
        },
        onerror: () => fail(new TypeError("Misskey network request failed")),
        ontimeout: () =>
          fail(new TypeError("Misskey network request timed out")),
        onabort: () => fail(new DOMException("Aborted", "AbortError")),
      });
    });
  };

  Object.defineProperty(unsafeWindow, "GM_Misskey_getNote", {
    configurable: false,
    writable: false,
    value: getNote,
  });
})();
