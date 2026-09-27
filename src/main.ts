import { insertText } from "jsr:@cosense/std@^0.29.16/browser/dom";
import type { Scrapbox } from "jsr:@cosense/types@^0.10.10/userscript";
import {
  convert,
  convertGyazoURL,
  convertScrapboxURL,
  expandShortURL,
  formatURL,
  formatWikipedia,
  redirectGoogleSearch,
  redirectWikiwand,
  shortenAmazonURL,
} from "jsr:@takker/scrapbox-url-customizer@^0.4.8";
import { formatBlueskyPost } from "./bluesky/format_post.ts";
import { formatInstagramPost } from "./instagram/format_post.ts";
import { formatAuthenticatedTweet } from "./twitter/authenticated_tweet.ts";

declare const scrapbox: Scrapbox;

const middlewares = [
  redirectGoogleSearch,
  expandShortURL,
  redirectGoogleSearch,
  redirectWikiwand,
  shortenAmazonURL,
  convertScrapboxURL(),
  convertGyazoURL,
  formatAuthenticatedTweet(),
  formatBlueskyPost(),
  formatInstagramPost(),
  formatWikipedia,
  formatURL(),
] as const;

scrapbox.PopupMenu.addButton({
  title: (text) => /https?:\/\/\S+/.test(text) ? "URL" : "",
  onClick: (text) => {
    const converted = convert(text, ...middlewares);
    if (typeof converted === "string") {
      return text === converted ? undefined : converted;
    }
    converted.then((result) => {
      if (text !== result) return insertText(result);
    });
    return undefined;
  },
});
