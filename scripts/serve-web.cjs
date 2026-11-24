const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const root = path.resolve(__dirname, "../web-dist");
const port = Number(process.env.WF_WEB_PORT ?? 4173);
const contentTypes = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".png": "image/png",
    ".mp3": "audio/mpeg",
};

if (!fs.existsSync(path.join(root, "index.html"))) {
    console.error("请先执行 npm run build:web。");
    process.exit(1);
}

const server = http.createServer(async (request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { Allow: "GET, HEAD" }).end();
        return;
    }

    let pathname;
    try {
        pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
    } catch {
        response.writeHead(400).end();
        return;
    }

    const file = path.resolve(root, "." + (pathname === "/" ? "/index.html" : pathname));
    const relative = path.relative(root, file);
    if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
        response.writeHead(403).end();
        return;
    }

    try {
        const contents = await fs.promises.readFile(file);
        response.writeHead(200, {
            "Content-Type": contentTypes[path.extname(file)] || "application/octet-stream",
            "Content-Length": contents.length,
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        });
        response.end(request.method === "HEAD" ? undefined : contents);
    } catch (error) {
        if (!["ENOENT", "ENOTDIR", "EISDIR"].includes(error.code)) {
            console.error("网页资源读取失败", error);
            response.writeHead(500).end();
            return;
        }
        response.writeHead(404).end();
    }
});

server.listen(port, "127.0.0.1", () => {
    console.log(`WF美工助手网页预览 http://127.0.0.1:${server.address().port}/`);
});
