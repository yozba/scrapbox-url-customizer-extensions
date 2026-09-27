// ==UserScript==
// @name         Cosense Bluesky Auth Bridge
// @namespace    https://github.com/yozba/scrapbox-url-customizer-extensions
// @version      0.1.0
// @description  Relays one read-only Bluesky post lookup through a logged-in bsky.app tab.
// @author       yozba
// @match        https://scrapbox.io/*
// @match        https://bsky.app/*
// @grant        GM_addValueChangeListener
// @grant        GM_deleteValue
// @grant        GM_removeValueChangeListener
// @grant        GM_setValue
// @grant        unsafeWindow
// @noframes
// @run-at       document-start
// @downloadURL  https://raw.githubusercontent.com/yozba/scrapbox-url-customizer-extensions/authenticated-media/userscripts/bluesky-auth-bridge.user.js
// @updateURL    https://raw.githubusercontent.com/yozba/scrapbox-url-customizer-extensions/authenticated-media/userscripts/bluesky-auth-bridge.user.js
// @license      MIT
// ==/UserScript==

(() => {
  "use strict";

  const REQUEST_KEY = "cosense-bluesky-auth-request-v1";
  const RESPONSE_PREFIX = "cosense-bluesky-auth-response-v1:";
  const AT_URI_PATTERN =
    /^at:\/\/did:[^/\s]+\/app\.bsky\.feed\.post\/[A-Za-z0-9._~:-]+$/;

  const isRequest = (value) =>
    value !== null && typeof value === "object" &&
    typeof value.id === "string" && /^[A-Za-z0-9-]+$/.test(value.id) &&
    typeof value.atURI === "string" && AT_URI_PATTERN.test(value.atURI) &&
    typeof value.createdAt === "number";

  const messageFor = (error) =>
    error instanceof Error ? error.message : String(error);

  if (location.hostname === "bsky.app") {
    const readCurrentAccount = () => {
      const raw = unsafeWindow.localStorage.getItem("BSKY_STORAGE");
      if (!raw) throw new Error("Bluesky login session was not found");

      const persisted = JSON.parse(raw);
      const session = persisted?.session;
      const currentDid = session?.currentAccount?.did;
      const account = Array.isArray(session?.accounts)
        ? session.accounts.find((candidate) => candidate?.did === currentDid)
        : undefined;
      if (!account || typeof account.accessJwt !== "string") {
        throw new Error("Bluesky login session has no active access token");
      }

      const service = new URL(account.pdsUrl ?? account.service);
      if (service.protocol !== "https:") {
        throw new Error("Bluesky PDS must use HTTPS");
      }
      return { accessJwt: account.accessJwt, service };
    };

    const sanitizePost = (post) => ({
      uri: post.uri,
      cid: post.cid,
      author: {
        did: post.author?.did,
        handle: post.author?.handle,
        ...(typeof post.author?.displayName === "string"
          ? { displayName: post.author.displayName }
          : {}),
      },
      record: post.record,
      ...(post.embed === undefined ? {} : { embed: post.embed }),
      indexedAt: post.indexedAt,
    });

    const getPost = async (atURI) => {
      const { accessJwt, service } = readCurrentAccount();
      const url = new URL("/xrpc/app.bsky.feed.getPosts", service);
      url.searchParams.append("uris", atURI);
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessJwt}`,
          "atproto-proxy": "did:web:api.bsky.app#bsky_appview",
        },
        credentials: "omit",
      });
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 300);
        throw new Error(
          `Bluesky authenticated request failed: ${response.status} ${response.statusText}: ${detail}`,
        );
      }

      const payload = await response.json();
      const post = payload?.posts?.[0];
      if (!post || typeof post !== "object") {
        throw new Error("Bluesky returned no post for the logged-in account");
      }
      return sanitizePost(post);
    };

    const respond = async (request, response) => {
      const key = `${RESPONSE_PREFIX}${request.id}`;
      await GM_setValue(key, response);
      setTimeout(() => GM_deleteValue(key), 10_000);
    };

    GM_addValueChangeListener(REQUEST_KEY, (_key, _oldValue, request) => {
      if (!isRequest(request) || Date.now() - request.createdAt > 30_000) {
        return;
      }
      getPost(request.atURI).then(
        (post) => respond(request, { ok: true, post }),
        (error) => respond(request, { ok: false, error: messageFor(error) }),
      );
    });
    return;
  }

  if (location.hostname !== "scrapbox.io") return;

  const getPost = (atURI) => {
    if (typeof atURI !== "string" || !AT_URI_PATTERN.test(atURI)) {
      return Promise.reject(new TypeError("Invalid Bluesky post AT URI"));
    }

    return new Promise((resolve, reject) => {
      const id = typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const responseKey = `${RESPONSE_PREFIX}${id}`;
      let settled = false;

      const cleanup = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (listenerId !== undefined) {
          GM_removeValueChangeListener(listenerId);
        }
        GM_deleteValue(responseKey);
      };

      const listenerId = GM_addValueChangeListener(
        responseKey,
        (_key, _oldValue, response) => {
          if (settled || response === null || typeof response !== "object") {
            return;
          }
          cleanup();
          if (response.ok) resolve(response.post);
          else reject(new Error(response.error ?? "Bluesky request failed"));
        },
      );

      const timeout = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            "No logged-in bsky.app tab responded; keep bsky.app open and try again",
          ),
        );
      }, 20_000);

      GM_setValue(REQUEST_KEY, { id, atURI, createdAt: Date.now() });
    });
  };

  Object.defineProperty(unsafeWindow, "GM_Bluesky_getPost", {
    configurable: true,
    value: getPost,
  });
})();
