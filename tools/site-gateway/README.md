# Site gateway

One small computer at each site that lets the CRM show that site's cameras **live**.

The cameras speak RTSP, which a web browser cannot play, and they must never be opened to the
internet. So this gateway sits on the site's network, pulls the cameras over RTSP, and publishes them
as a web page through a Cloudflare tunnel. The CRM only needs that page's address.

```
cameras ──RTSP──► go2rtc ──► proxy (answers only under a secret path) ──► Cloudflare tunnel ──► CRM
(site LAN)                    (this computer)                              (outbound only)
```

Nothing is opened on the site's router: the tunnel connects *out* to Cloudflare.

## What you need at each site

| | |
|---|---|
| A small always-on computer on the same network as the cameras | Raspberry Pi 4/5, or a mini PC (Intel N100 is plenty). It does not transcode, so it stays cool. |
| Docker with Docker Compose | `curl -fsSL https://get.docker.com \| sh` |
| A Cloudflare account (free) | For the tunnel. One tunnel per site. |
| Internet at the site | Upload speed matters, see *Bandwidth* below. |

## Set up (about 20 minutes)

### 1. Get the cameras ready
In each camera's web page:
1. Give it a **fixed IP address** (or reserve it in the router), e.g. 192.168.1.64 to .67.
2. Set the video encoding to **H.264** for the stream you will watch. The camera also offers H.265,
   but browsers cannot all play H.265, and converting it would make this computer work hard.
3. Note the camera login (username and password).
4. For a smooth picture over the site's internet, use the **sub stream** (640×360 to 1280×720,
   about 512 kbps to 1 Mbps) rather than the 3MP main stream.

### 2. Find the camera's RTSP address
It has the form `rtsp://USER:PASSWORD@IP:554/PATH`. The path depends on the camera model, and the
model's manual or the supplier gives it. Test it in **VLC** (Media → Open Network Stream) before going
further. Common ones to try if the manual is missing:

`/stream1` · `/Streaming/Channels/101` · `/h264/ch1/main/av_stream` · `/cam/realmonitor?channel=1&subtype=0`

(The cameras support **ONVIF**, so a tool like ONVIF Device Manager will also list the exact RTSP address.)

### 3. Create the Cloudflare tunnel
1. Cloudflare dashboard → **Zero Trust → Networks → Tunnels → Create a tunnel** (Cloudflared).
2. Copy the **tunnel token** it shows.
3. Add a **Public hostname**, e.g. `site-chiranjivi.yourdomain.com`, service **HTTP** → `proxy:80`.

### 4. Configure and start
```bash
cd tools/site-gateway
python3 generate-config.py --user admin --password 'CAMERA-PASSWORD' \
    --camera gate=192.168.1.64 --camera blocka=192.168.1.65 \
    --camera blockb=192.168.1.66 --camera road=192.168.1.67
# open .env and paste the tunnel token after CLOUDFLARE_TUNNEL_TOKEN=
docker compose up -d
```
`generate-config.py` writes `go2rtc.yaml` and `.env` (they hold the camera password and the secret path,
and are git-ignored) and prints the live address for each camera. Pass `--path` if the cameras' RTSP
path is not `/stream1`.

### 5. Add the cameras in the CRM
**Site cameras → Add camera**: name, the site (project), where it points, and the **Live address**
the script printed:

```
https://site-chiranjivi.yourdomain.com/<secret>/stream.html?src=gate&mode=mse
```

Open the site in the CRM and the four cameras play side by side.

## Bandwidth
The gateway pulls each camera **once**, however many people watch, so the camera's own limit of 3
viewers never matters. What the site's *upload* has to carry is the stream's bitrate **times the number
of cameras being watched at once**: four cameras on 1 Mbps sub streams is about 4 Mbps up for one viewer,
8 Mbps for two. Nothing is sent when nobody is watching.

## Security
- The cameras are never reachable from the internet; the tunnel is outbound only.
- The proxy answers **only under the long random path** in `.env` (`STREAM_TOKEN`) and gives a plain
  404 to anything else. The live address *is* the key, so treat it like a password: it is visible to
  anyone who can open the camera's page in the CRM, and it is stored in the CRM.
- To cut off a leaked address, run `generate-config.py --token NEW ...` (or delete the `.env` line so it
  makes a new one), `docker compose up -d`, and update the live addresses in the CRM.
- Do not publish ports 1984 or 8554 on this computer.

## When something is wrong
| You see | Check |
|---|---|
| "The camera is not answering" in the CRM | `docker compose logs go2rtc`: wrong RTSP path or password, or the camera is off. Test the RTSP address in VLC from this computer. |
| The picture is black or stuck | The stream is H.265: set the camera to H.264. |
| 404 in the CRM tile | The secret in the live address does not match `STREAM_TOKEN` in `.env`. |
| Works at the site, not from outside | `docker compose logs tunnel`: the tunnel token, and that the public hostname points to `http://proxy:80`. |
| Choppy picture | Use the sub stream, or the site's upload is too slow for that many cameras at once. |

Useful: `docker compose ps`, `docker compose logs -f`, and `http://<this-computer>:1984` is **not**
reachable by design; to look at go2rtc's own page while setting up, temporarily add `ports: ["1984:1984"]`
under `go2rtc` and remove it again afterwards.
