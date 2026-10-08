export interface FeedItem {
  sourceId?:string; sourceName?:string; sourceUrl?:string; detectedAt?:string; content?:string; descriptionHtml?:string;
  title: string;
  url: string;
  description: string;
  publishedAt?: string;
  originalDate?: string;
  author?: string;
  image?: string;
  category?: string;
  guid: string;
}
export interface RawItem {
  sourceId?:string; sourceName?:string; sourceUrl?:string; detectedAt?:string; content?:string; descriptionHtml?:string; originalDate?:string;
  title?: unknown; url?: unknown; canonicalUrl?: unknown; description?: unknown;
  publishedAt?: unknown; author?: unknown; image?: unknown; category?: unknown; guid?: unknown;
}
export type Method = "rss" | "html" | "browser" | "api";
export interface Extraction {
  method: Method;
  items: FeedItem[];
  confidence: number;
  title?: string;
  description?: string;
  sourceUrl?: string;
  detail: string;
}
export interface ProgressEvent {
  step: string;
  status: "running" | "success" | "warning" | "error";
  message: string;
}
export interface Analysis {
  watchReport?: {analyzed:number;kept:number;excluded:number;duplicates:{kept:string;removed:string;score:number}[]};
  settings?: import("./settings").Settings;
  id: string; url: string; title: string; description: string;
  items: FeedItem[]; method: Method; confidence: number;
  sourceUrl?: string; detail: string; createdAt: string;
}
export type Progress = (event: ProgressEvent) => void;
