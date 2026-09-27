import type { Scrapbox } from "jsr:@cosense/types@^0.10.10/userscript";
import {
  convert,
  convertGyazoURL,
  convertScrapboxURL,
  expandShortURL,
  formatTweet,
  formatURL,
  formatWikipedia,
  redirectGoogleSearch,
  redirectWikiwand,
  shortenAmazonURL,
} from "./deps/scrapbox_url_customizer.ts";
import { insertText } from "./deps/cosense_std.ts";
import { formatBlueskyPost } from "./bluesky/format_post.ts";
import { formatRootTweet } from "./twitter/format_tweet.ts";

declare const scrapbox: Scrapbox;

const middlewares = [
  redirectGoogleSearch,
  expandShortURL,
  redirectGoogleSearch,
  redirectWikiwand,
  shortenAmazonURL,
  convertScrapboxURL(),
  convertGyazoURL,
  formatTweet(formatRootTweet),
  formatBlueskyPost(),
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
