export interface InstagramPostReference {
  shortcode: string;
  canonicalURL: URL;
}

export interface InstagramOEmbed {
  title?: string;
  author_name?: string;
  author_url?: string;
  media_id: string;
  html?: string;
  thumbnail_url?: string;
  thumbnail_width?: number;
  thumbnail_height?: number;
}

export interface InstagramImageCandidate {
  url: string;
  width?: number;
  height?: number;
}

export interface InstagramMediaItem {
  media_type?: number;
  caption?: { text?: string } | null;
  user?: { username?: string };
  image_versions2?: { candidates?: InstagramImageCandidate[] };
  video_versions?: InstagramImageCandidate[];
  carousel_media?: InstagramMediaItem[];
}

export interface InstagramPost {
  reference: InstagramPostReference;
  oembed: InstagramOEmbed;
  authenticated?: InstagramMediaItem;
}

export type InstagramMedia = {
  type: "image" | "video";
  url: URL;
};
