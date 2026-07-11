export interface RetrievedDocument {
  requestedUrl: string;
  resolvedUrl: string;
  status: number;
  contentType: string;
  mode: "http" | "browser";
  body: Buffer;
}
