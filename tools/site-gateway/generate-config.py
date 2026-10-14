#!/usr/bin/env python3
"""
Writes go2rtc.yaml and .env for one site, so nobody types a camera password into a YAML file by hand.

  python3 generate-config.py \
      --user admin --password 'the-camera-password' \
      --camera gate=192.168.1.64 --camera blocka=192.168.1.65 \
      --camera blockb=192.168.1.66 --camera road=192.168.1.67

The RTSP path is the same for every camera of one model; the default is the most common one. If a
camera does not answer, find the right path for the model (see README.md) and pass --path.
"""
import argparse
import secrets
import sys
from pathlib import Path
from urllib.parse import quote


def main() -> int:
    p = argparse.ArgumentParser(description="Write go2rtc.yaml and .env for a site.")
    p.add_argument("--user", required=True, help="the camera login")
    p.add_argument("--password", required=True, help="the camera password")
    p.add_argument("--camera", action="append", required=True, metavar="NAME=IP", help="repeat for each camera, e.g. gate=192.168.1.64")
    p.add_argument("--path", default="/stream1", help="RTSP path on the camera (default /stream1)")
    p.add_argument("--port", default="554", help="RTSP port (default 554)")
    p.add_argument("--token", help="reuse an existing secret path instead of making a new one")
    args = p.parse_args()

    streams = []
    for item in args.camera:
        name, _, ip = item.partition("=")
        name = name.strip().lower()
        if not name.isidentifier() or not ip.strip():
            print(f"'{item}' is not NAME=IP (the name must be letters, digits and _).", file=sys.stderr)
            return 1
        # A password with @ : / or # would break the address, so it is percent-encoded.
        url = f"rtsp://{quote(args.user, safe='')}:{quote(args.password, safe='')}@{ip.strip()}:{args.port}{args.path}"
        streams.append((name, url))

    here = Path(__file__).parent
    (here / "go2rtc.yaml").write_text(
        "api:\n  listen: \":1984\"\nrtsp:\n  listen: \"\"\nstreams:\n" + "".join(f"  {n}: {u}\n" for n, u in streams)
    )
    token = args.token or secrets.token_urlsafe(24)
    env = here / ".env"
    tunnel = ""
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("CLOUDFLARE_TUNNEL_TOKEN="):
                tunnel = line.split("=", 1)[1]
    env.write_text(f"STREAM_TOKEN={token}\nCLOUDFLARE_TUNNEL_TOKEN={tunnel}\n")

    print(f"Wrote go2rtc.yaml ({len(streams)} cameras) and .env.")
    if not tunnel:
        print("Now put the Cloudflare tunnel token in .env (CLOUDFLARE_TUNNEL_TOKEN=...).")
    print("\nAdd each camera in the CRM (Site cameras → Add camera) with this live address, after the tunnel is up:")
    for n, _ in streams:
        print(f"  {n}:  https://<your-site-hostname>/{token}/stream.html?src={n}&mode=mse")
    return 0


if __name__ == "__main__":
    sys.exit(main())
