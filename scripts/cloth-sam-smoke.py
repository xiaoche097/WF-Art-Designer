"""Run an authenticated HTTP smoke test using the official model and a synthetic shirt."""

import json
import secrets
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "local-engine"))
from service import HOST, PORT, Segmenter, handler_for


def main():
    began = time.perf_counter()
    engine = Segmenter(Path(sys.argv[1]), "cpu")
    print(f"CPU model load: {time.perf_counter() - began:.2f}s", flush=True)
    token = secrets.token_hex(32)
    image = Image.new("RGBA", (256, 256), "ivory")
    draw = ImageDraw.Draw(image)
    draw.polygon([(60, 60), (100, 36), (115, 55), (141, 55), (156, 36), (196, 60), (230, 93),
                  (199, 126), (178, 109), (178, 221), (78, 221), (78, 109), (57, 126), (26, 93)],
                 fill="#93396a")
    points = [{"x": 125, "y": 146, "positive": True}, {"x": 24, "y": 205, "positive": False}]

    def request(key, hints):
        return urllib.request.urlopen(urllib.request.Request(
            f"http://{HOST}:{PORT}/v1/segment", data=image.tobytes(), headers={
                "Authorization": f"Bearer {key}", "Content-Type": "application/octet-stream",
                "X-Cloth-Request": json.dumps({"width": 256, "height": 256, "points": hints}),
            }), timeout=120)

    with ThreadingHTTPServer((HOST, PORT), handler_for(engine, token)) as server:
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            try:
                request("invalid", points)
            except urllib.error.HTTPError as error:
                assert error.code == 401
                error.close()
            else:
                raise AssertionError("Unauthenticated request unexpectedly passed")
            for count in range(1, 3):
                start = time.perf_counter()
                with request(token, points[:count]) as response:
                    score = float(response.headers["X-Cloth-Score"])
                    mask = np.frombuffer(response.read(), np.uint8).reshape(256, 256)
                assert mask[146, 125] > 0 and mask[205, 24] == 0
                assert ((mask > 0) & (mask < 255)).any()
                print(f"CPU HTTP, {count} prompt(s): {time.perf_counter() - start:.2f}s, "
                      f"{np.count_nonzero(mask)} pixels, model score {score:.4f}", flush=True)
        finally:
            server.shutdown()
            thread.join()


if __name__ == "__main__":
    main()
