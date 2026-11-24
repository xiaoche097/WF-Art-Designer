"""Authenticated loopback-only SAM 2.1 Tiny service."""

import argparse
import hashlib
import hmac
import json
import math
import secrets
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

HOST, PORT = "127.0.0.1", 49321
MODEL_CONFIG = "configs/sam2.1/sam2.1_hiera_t.yaml"
MAX_EDGE = 640
MAX_BODY = MAX_EDGE * MAX_EDGE * 4


class Segmenter:
    def __init__(self, checkpoint, device):
        if not checkpoint.is_file():
            raise FileNotFoundError(f"SAM 2.1 Tiny checkpoint missing: {checkpoint}")
        import torch
        from sam2.build_sam import build_sam2
        from sam2.sam2_image_predictor import SAM2ImagePredictor

        if device == "cuda" and not torch.cuda.is_available():
            raise RuntimeError("CUDA is unavailable. Start with --device cpu.")
        # CPU threads are bounded to avoid starving Photoshop.
        if device == "cpu":
            torch.set_num_threads(min(torch.get_num_threads(), 8))
        self.predictor = SAM2ImagePredictor(build_sam2(MODEL_CONFIG, str(checkpoint), device=device))
        self.torch = torch
        self.lock = threading.Lock()
        self.image_key = None

    def segment(self, rgba, width, height, points):
        image = np.frombuffer(rgba, np.uint8).reshape(height, width, 4)
        rgb = image[:, :, :3].astype(np.float32)
        alpha = image[:, :, 3:4].astype(np.float32) / 255.0
        rgb = np.rint(rgb * alpha + 255.0 * (1 - alpha)).astype(np.uint8)
        coords = np.array([(p["x"], p["y"]) for p in points])
        labels = np.array([int(p["positive"]) for p in points])
        key = (width, height, hashlib.sha256(rgba).digest())
        with self.lock, self.torch.inference_mode():
            if self.image_key != key:
                self.image_key = None
                self.predictor.set_image(rgb)
                self.image_key = key
            masks, scores, _ = self.predictor.predict(
                point_coords=coords, point_labels=labels, multimask_output=True
            )
        # A candidate must honor each hint. An ambiguous result is handed back for correction.
        inside = masks[:, coords[:, 1], coords[:, 0]]
        usable = [i for i, score in enumerate(scores) if math.isfinite(score) and np.all(inside[i] == labels)]
        if not usable:
            raise ValueError("SAM 无法同时满足正负点。请修改提示点或使用 Photoshop 蒙版。")
        best = max(usable, key=lambda i: float(scores[i]))
        support = masks[best].astype(np.uint8) * 255
        blurred = np.asarray(Image.fromarray(support).filter(ImageFilter.GaussianBlur(radius=0.7)))
        # Feather inward only. Keep thin details and never expand the model's support.
        mask = np.minimum(blurred, support)
        return mask.tobytes(), float(scores[best])


def parse_hints(value):
    if not value or len(value) > 8192:
        raise ValueError("缺少有效的分割参数")
    hints = json.loads(value)
    if not isinstance(hints, dict):
        raise ValueError("分割参数必须是对象")
    w, h, points = hints.get("width"), hints.get("height"), hints.get("points")
    if any(type(n) is not int or not 1 <= n <= MAX_EDGE for n in (w, h)):
        raise ValueError("分割尺寸超出范围")
    if not isinstance(points, list) or not 1 <= len(points) <= 64:
        raise ValueError("正负点数量超出范围")
    for p in points:
        if not isinstance(p, dict):
            raise ValueError("分割提示点无效")
        x, y, positive = p.get("x"), p.get("y"), p.get("positive")
        if type(x) is not int or type(y) is not int or not (0 <= x < w and 0 <= y < h) or type(positive) is not bool:
            raise ValueError("分割提示点越界")
    if not any(p["positive"] for p in points):
        raise ValueError("请提供至少一个正点")
    return w, h, points


def handler_for(engine, token):
    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            self.request.settimeout(15)
            super().setup()

        def write_response(self, code, content, content_type, **headers):
            self.send_response(code)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "no-store")
            for field, value in headers.items():
                self.send_header(field, value)
            self.end_headers()
            self.wfile.write(content)

        def error_response(self, code, message):
            self.write_response(code, json.dumps({"error": message}, ensure_ascii=False).encode("utf-8"),
                                "application/json; charset=utf-8")

        def do_POST(self):
            if self.path != "/v1/segment" or self.headers.get("Host") != f"{HOST}:{PORT}":
                self.error_response(404, "接口不存在")
                return
            auth = self.headers.get("Authorization", "").encode("utf-8")
            if not hmac.compare_digest(auth, f"Bearer {token}".encode("ascii")):
                # Consume only bounded bodies so Windows can deliver the 401 before closing.
                raw_length = self.headers.get("Content-Length", "")
                if raw_length.isascii() and raw_length.isdigit() and len(raw_length) <= 7:
                    length = int(raw_length)
                    if 0 < length <= MAX_BODY:
                        try:
                            self.rfile.read(length)
                        except TimeoutError:
                            return
                self.error_response(401, "本地 SAM 配对码无效")
                return
            try:
                width, height, points = parse_hints(self.headers.get("X-Cloth-Request"))
                length = int(self.headers.get("Content-Length", "0"))
                if length != width * height * 4 or self.headers.get("Content-Type") != "application/octet-stream":
                    raise ValueError("图像格式或长度无效")
                rgba = self.rfile.read(length)
                if len(rgba) != length:
                    raise ValueError("原图数据不完整")
                mask, score = engine.segment(rgba, width, height, points)
            except (ValueError, TimeoutError) as exc:
                self.error_response(400, str(exc))
                return
            except Exception as exc:
                self.log_error("SAM inference error: %s", type(exc).__name__)
                self.error_response(500, "SAM 推理失败，请检查本地服务或使用 Photoshop 蒙版")
                return
            self.write_response(200, mask, "application/octet-stream", **{"X-Cloth-Score": str(score)})

    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--device", choices=["cpu", "cuda"], default="cpu")
    opts = parser.parse_args()
    engine = Segmenter(opts.checkpoint, opts.device)
    token = secrets.token_hex(32)
    with ThreadingHTTPServer((HOST, PORT), handler_for(engine, token)) as server:
        print(f"SAM 2.1 Tiny ready at http://{HOST}:{PORT}. Device: {opts.device}", flush=True)
        print(f"Pairing code: {token}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
