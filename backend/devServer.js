const fs = require("fs/promises");
const path = require("path");
const http = require("http");

require("dotenv").config({ path: path.resolve(__dirname, ".env") });
const createApp = require("./app");

const DEV_PORT = Number(process.env.DEV_PORT || 5173);
const CLIENT_ROOT = path.resolve(__dirname, "..", "client");

const startDevServer = async () => {
  const app = createApp({ enableRootHealthRoute: false });
  const httpServer = http.createServer(app);

  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    root: CLIENT_ROOT,
    appType: "custom",
    server: {
      middlewareMode: true,
      hmr: {
        server: httpServer,
      },
    },
  });

  app.use(vite.middlewares);

  app.use(async (req, res, next) => {
    if (req.originalUrl.startsWith("/api")) {
      return next();
    }

    try {
      const indexPath = path.resolve(CLIENT_ROOT, "index.html");
      const template = await fs.readFile(indexPath, "utf-8");
      const transformed = await vite.transformIndexHtml(req.originalUrl, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(transformed);
    } catch (error) {
      vite.ssrFixStacktrace(error);
      next(error);
    }
  });

  app.use((err, req, res, next) => {
    if (res.headersSent) {
      return next(err);
    }

    if (String(err?.name || "") === "MulterError") {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ message: "Image size must be 5MB or less" });
      }
      return res.status(422).json({ message: err?.message || "Invalid image upload request" });
    }

    const statusCode =
      Number.isInteger(err?.status) ? err.status : Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    const message = statusCode >= 500 ? "Internal server error" : err?.message || "Request failed";

    return res.status(statusCode).json({ message });
  });

  httpServer.on("error", (error) => {
    if (error && error.code === "EADDRINUSE") {
      console.error(
        `Port ${DEV_PORT} is already in use. Stop the process using this port or set DEV_PORT to a free port in backend/.env.`
      );
      process.exit(1);
    }

    console.error("Single-port dev server failed:", error);
    process.exit(1);
  });

  httpServer.listen(DEV_PORT, () => {
    console.log(`Dev server running on http://localhost:${DEV_PORT}`);
  });
};

startDevServer().catch((error) => {
  console.error("Failed to start single-port dev server:", error);
  process.exit(1);
});
