export interface BlueskyPostReference {
  actor: string;
  rkey: string;
}

export interface BlueskyFacetFeature {
  $type: string;
  uri?: string;
  did?: string;
  tag?: string;
}

export interface BlueskyFacet {
  index: {
    byteStart: number;
    byteEnd: number;
  };
  features: BlueskyFacetFeature[];
}

export interface BlueskyImageView {
  thumb: string;
  fullsize: string;
  alt?: string;
}

export interface BlueskyExternalView {
  uri: string;
  title?: string;
  description?: string;
  thumb?: string;
}

export interface BlueskyEmbedView {
  $type?: string;
  images?: BlueskyImageView[];
  media?: BlueskyEmbedView;
  external?: BlueskyExternalView;
  // A quoted record is deliberately left opaque. It must not be expanded.
  record?: unknown;
}

export interface BlueskyPost {
  uri: string;
  cid: string;
  author: {
    did: string;
    handle: string;
    displayName?: string;
  };
  record: {
    $type?: string;
    text: string;
    facets?: BlueskyFacet[];
    createdAt: string;
    reply?: unknown;
    embed?: unknown;
  };
  embed?: BlueskyEmbedView;
  indexedAt: string;
}
