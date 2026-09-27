// ==UserScript==
// @name         Cosense Safe Fetch
// @namespace    https://github.com/yozba/scrapbox-url-customizer-extensions
// @version      0.1.0
// @description  Exposes an anonymous, read-only cross-origin fetch for Cosense URL expansion.
// @author       yozba
// @match        https://scrapbox.io/*
// @connect      *
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @noframes
// @run-at       document-start
// @downloadURL  https://raw.githubusercontent.com/yozba/scrapbox-url-customizer-extensions/main/userscripts/safe-fetch.user.js
// @updateURL    https://raw.githubusercontent.com/yozba/scrapbox-url-customizer-extensions/main/userscripts/safe-fetch.user.js
// @license      MIT
// ==/UserScript==

(() => {
  "use strict";

  const MAX_RESPONSE_BYTES = 256 * 1024 * 1024;
  const MAX_REDIRECTS = 5;
  const TIMEOUT_MS = 120_000;
  const ALLOWED_REQUEST_HEADERS = new Set([
    "accept",
    "accept-language",
    "range",
  ]);

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

  const checkedURL = (input) => {
    const url = new URL(input);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new TypeError("Safe fetch only supports HTTP and HTTPS URLs");
    }
    const hostname = url.hostname.toLowerCase();
    if (
      hostname === "localhost" || hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") || hostname.endsWith(".internal") ||
      hostname.endsWith(".lan") || isPrivateIPv4(hostname) ||
      isPrivateIPv6(hostname)
    ) {
      throw new TypeError("Safe fetch does not access local or private hosts");
    }
    return url;
  };

  const safeHeaders = (headers) => {
    const result = {};
    for (const [name, value] of new Headers(headers)) {
      if (!ALLOWED_REQUEST_HEADERS.has(name.toLowerCase())) {
        throw new TypeError(`Safe fetch does not allow the ${name} header`);
      }
      result[name] = value;
    }
    return result;
  };

  const parseResponseHeaders = (rawHeaders) =>
    new Headers(
      String(rawHeaders ?? "")
        .replace(/\r?\n[\t ]+/g, " ")
        .split(/\r\n|\r|\n/)
        .flatMap((line) => {
          const index = line.indexOf(":");
          return index <= 0
            ? []
            : [[line.slice(0, index).trim(), line.slice(index + 1).trim()]];
        }),
    );

  const requestOnce = (url, method, headers) =>
    new Promise((resolve, reject) => {
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      const control = GM_xmlhttpRequest({
        method,
        url: url.href,
        headers,
        anonymous: true,
        responseType: "arraybuffer",
        redirect: "manual",
        fetch: true,
        timeout: TIMEOUT_MS,
        onprogress: (event) => {
          if (event.loaded > MAX_RESPONSE_BYTES) {
            control?.abort();
            fail(new RangeError("Safe fetch response exceeded 256 MiB"));
          }
        },
        onload: (result) => {
          if (settled) return;
          const response = result.response instanceof ArrayBuffer
            ? result.response
            : new ArrayBuffer(0);
          if (response.byteLength > MAX_RESPONSE_BYTES) {
            fail(new RangeError("Safe fetch response exceeded 256 MiB"));
            return;
          }
          settled = true;
          resolve({
            status: result.status,
            statusText: result.statusText,
            headers: parseResponseHeaders(result.responseHeaders),
            response,
            finalURL: result.finalUrl || url.href,
          });
        },
        onerror: () => fail(new TypeError("Safe fetch network request failed")),
        ontimeout: () =>
          fail(new TypeError("Safe fetch network request timed out")),
        onabort: () => fail(new DOMException("Aborted", "AbortError")),
      });
    });

  const safeFetch = async (input, init = {}) => {
    const request = new Request(input, init);
    if (request.method !== "GET" && request.method !== "HEAD") {
      throw new TypeError("Safe fetch only allows GET and HEAD requests");
    }
    if (request.credentials === "include") {
      throw new TypeError("Safe fetch never sends browser credentials");
    }

    const headers = safeHeaders(request.headers);
    let url = checkedURL(request.url);
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      const result = await requestOnce(url, request.method, headers);
      const location = result.headers.get("location");
      if (result.status >= 300 && result.status < 400 && location) {
        if (redirects === MAX_REDIRECTS) {
          throw new TypeError("Safe fetch followed too many redirects");
        }
        url = checkedURL(new URL(location, url));
        continue;
      }

      const finalURL = checkedURL(result.finalURL);
      const response = new Response(
        request.method === "HEAD" ? null : result.response,
        {
          status: result.status,
          statusText: result.statusText,
          headers: result.headers,
        },
      );
      Object.defineProperty(response, "url", { value: finalURL.href });
      return response;
    }
    throw new TypeError("Safe fetch failed to resolve the request");
  };

  Object.defineProperty(unsafeWindow, "GM_fetch", {
    configurable: false,
    writable: false,
    value: safeFetch,
  });
})();
