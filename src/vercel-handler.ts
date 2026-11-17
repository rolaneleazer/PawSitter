import app from "../server.ts";

export default function handler(req: any, res: any) {
  if (req.url) {
    try {
      const parsed = new URL(req.url, "http://localhost");
      const vpath = parsed.searchParams.get("__vpath");
      if (vpath) {
        parsed.searchParams.delete("__vpath");
        const normalizedPath = vpath.startsWith("/") ? vpath : `/${vpath}`;
        const remainingQuery = parsed.searchParams.toString();
        req.url = remainingQuery ? `${normalizedPath}?${remainingQuery}` : normalizedPath;
      } else if (!req.url.startsWith("/api") && req.url !== "/") {
        req.url = "/api" + req.url;
      }
    } catch {
      if (!req.url.startsWith("/api") && req.url !== "/") {
        req.url = "/api" + req.url;
      }
    }
  }
  return app(req, res);
}
