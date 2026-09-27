// ==UserScript==
// @name         Cosense X Auth Bridge
// @namespace    https://github.com/yozba/scrapbox-url-customizer-extensions
// @version      0.1.0
// @description  Exposes one cookie-isolated, read-only X post lookup to Cosense.
// @author       yozba
// @match        https://scrapbox.io/*
// @connect      x.com
// @connect      abs.twimg.com
// @grant        GM_cookie
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @run-at       document-start
// @downloadURL  https://raw.githubusercontent.com/yozba/scrapbox-url-customizer-extensions/main/userscripts/x-auth-bridge.user.js
// @updateURL    https://raw.githubusercontent.com/yozba/scrapbox-url-customizer-extensions/main/userscripts/x-auth-bridge.user.js
// @license      MIT
// ==/UserScript==

(() => {
  "use strict";

  const requestText = (url, headers = {}) =>
    new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        headers,
        anonymous: false,
        responseType: "text",
        fetch: true,
        onload: (result) => {
          if (result.status < 200 || result.status >= 300) {
            reject(
              new Error(
                `X request failed: ${result.status} ${result.statusText}: ${
                  String(result.responseText ?? result.response).slice(0, 300)
                }`,
              ),
            );
            return;
          }
          resolve(String(result.responseText ?? result.response));
        },
        onerror: () => reject(new TypeError("X network request failed")),
        ontimeout: () => reject(new TypeError("X network request timeout")),
      });
    });

  const getXCookie = (name) =>
    new Promise((resolve, reject) => {
      GM_cookie.list({ url: "https://x.com/" }, (cookies, error) => {
        if (error) {
          reject(new Error(`Could not access the X login session: ${error}`));
          return;
        }
        resolve(cookies.find((cookie) => cookie.name === name)?.value);
      });
    });

  const BEARER_TOKEN =
    "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

  const parseStringList = (source) =>
    source ? [...source.matchAll(/"([^"]+)"/g)].map((match) => match[1]) : [];

  let queryInfoPromise;
  const resolveTweetQueryInfo = () => {
    queryInfoPromise ??= (async () => {
      const html = await requestText("https://x.com/home");
      const mainHash = html.match(/main\.([a-z0-9]+)\.js/i)?.[1];
      if (!mainHash) throw new Error("Could not find X's current main bundle");

      const source = await requestText(
        `https://abs.twimg.com/responsive-web/client-web/main.${mainHash}.js`,
      );
      const operation = 'operationName:"TweetResultByRestId"';
      const operationIndex = source.indexOf(operation);
      if (operationIndex < 0) {
        throw new Error("Could not find TweetResultByRestId in X's bundle");
      }
      const section = source.slice(
        Math.max(0, operationIndex - 300),
        operationIndex + 12000,
      );
      const queryId = section.match(
        /queryId:"([^"]+)",operationName:"TweetResultByRestId"/,
      )?.[1];
      if (!queryId) {
        throw new Error("Could not find X's current tweet query ID");
      }

      const features = parseStringList(
        section.match(/featureSwitches:\[(.*?)\]/)?.[1],
      );
      const fieldToggles = parseStringList(
        section.match(/fieldToggles:\[(.*?)\]/)?.[1],
      );
      return { queryId, features, fieldToggles };
    })();
    return queryInfoPromise;
  };

  const buildFlags = (keys) =>
    Object.fromEntries(keys.map((key) => [key, true]));

  const getTweet = async (tweetId) => {
    if (!/^\d+$/.test(tweetId)) throw new TypeError("Invalid X post ID");

    const csrfToken = await getXCookie("ct0");
    if (!csrfToken) {
      throw new Error("X login cookie was not found; log in to x.com first");
    }
    const { queryId, features, fieldToggles } = await resolveTweetQueryInfo();
    const toggles = buildFlags(fieldToggles);
    if ("withGrokAnalyze" in toggles) toggles.withGrokAnalyze = false;
    if ("withDisallowedReplyControls" in toggles) {
      toggles.withDisallowedReplyControls = false;
    }

    const url = new URL(
      `https://x.com/i/api/graphql/${queryId}/TweetResultByRestId`,
    );
    url.searchParams.set(
      "variables",
      JSON.stringify({
        tweetId,
        withCommunity: true,
        includePromotedContent: false,
        withVoice: true,
      }),
    );
    if (features.length > 0) {
      url.searchParams.set("features", JSON.stringify(buildFlags(features)));
    }
    if (fieldToggles.length > 0) {
      url.searchParams.set("fieldToggles", JSON.stringify(toggles));
    }

    const text = await requestText(url.href, {
      Accept: "application/json",
      Authorization: `Bearer ${BEARER_TOKEN}`,
      Referer: `https://x.com/i/status/${tweetId}`,
      "X-CSRF-Token": csrfToken,
      "X-Twitter-Active-User": "yes",
      "X-Twitter-Auth-Type": "OAuth2Session",
      "X-Twitter-Client-Language": "ja",
    });
    const payload = JSON.parse(text);
    const result = payload?.data?.tweetResult?.result;
    if (!result) {
      const message = payload?.errors?.[0]?.message ??
        "X returned no tweet result";
      throw new Error(message);
    }
    return result;
  };

  Object.defineProperty(unsafeWindow, "GM_X_getTweet", {
    configurable: true,
    value: getTweet,
  });
})();
