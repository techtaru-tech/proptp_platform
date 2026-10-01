#!/usr/bin/env python3
"""
Rosium camera uploader.

Run this on the PC where the camera's pictures are saved, on a schedule (see README.md). Each run
looks in the folder for pictures it has not sent yet and pushes them to the CRM with the camera's
own key. It uses only the Python standard library, so there is nothing to install.

  python3 upload_photos.py --folder "D:/CameraPhotos" --url https://console.rosium.in --key rck_...

A picture that fails to send (no internet, server busy) is simply left for the next run. Sending
the same picture twice is harmless: the CRM stores it once.
"""
import argparse
import hashlib
import json
import mimetypes
import os
import sys
import time
import uuid
from datetime import datetime, timezone
from urllib import error, request

EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
MAX_FILES_PER_REQUEST = 20           # the CRM accepts at most 20 per request
MAX_BYTES_PER_REQUEST = 8 * 1024 * 1024  # stay well under the server's 20 MB request limit
SETTLE_SECONDS = 30                  # skip a file still being written by the camera software


def parse_args():
    p = argparse.ArgumentParser(description="Push new camera pictures to the Rosium CRM.")
    p.add_argument("--folder", default=os.environ.get("ROSIUM_FOLDER"), help="Folder the pictures are saved in (searched recursively).")
    p.add_argument("--url", default=os.environ.get("ROSIUM_URL", "https://console.rosium.in"), help="CRM address.")
    p.add_argument("--key", default=os.environ.get("ROSIUM_CAMERA_KEY"), help="This camera's key (starts with rck_).")
    p.add_argument("--state", default=None, help="Where to remember what was sent (default: next to the folder's name in your home directory).")
    p.add_argument("--newer-than-days", type=float, default=7, help="Ignore pictures older than this on the first run (default 7).")
    p.add_argument("--dry-run", action="store_true", help="List what would be sent, send nothing.")
    return p.parse_args()


def load_state(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_state(path, state):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f)
    os.replace(tmp, path)  # never leaves a half-written state file behind


def find_new(folder, state, newer_than_days):
    now = time.time()
    oldest = now - newer_than_days * 86400
    found = []
    for root, _dirs, files in os.walk(folder):
        for name in files:
            if os.path.splitext(name)[1].lower() not in EXTENSIONS:
                continue
            full = os.path.join(root, name)
            try:
                st = os.stat(full)
            except OSError:
                continue
            signature = f"{st.st_size}:{int(st.st_mtime)}"
            if state.get(full) == signature:
                continue  # already sent
            if now - st.st_mtime < SETTLE_SECONDS:
                continue  # still being written
            if not state and st.st_mtime < oldest:
                continue  # first run: do not flood the CRM with years of history
            found.append((full, st, signature))
    found.sort(key=lambda item: item[1].st_mtime)
    return found


def batches(items):
    batch, size = [], 0
    for item in items:
        n = item[1].st_size
        if batch and (len(batch) >= MAX_FILES_PER_REQUEST or size + n > MAX_BYTES_PER_REQUEST):
            yield batch
            batch, size = [], 0
        batch.append(item)
        size += n
    if batch:
        yield batch


def encode(batch):
    boundary = "----rosium" + uuid.uuid4().hex
    parts = []
    for full, st, _sig in batch:
        taken = datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).isoformat()
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="captured_at"\r\n\r\n{taken}\r\n'.encode())
    for full, _st, _sig in batch:
        mime = mimetypes.guess_type(full)[0] or "image/jpeg"
        with open(full, "rb") as f:
            data = f.read()
        head = f'--{boundary}\r\nContent-Disposition: form-data; name="images"; filename="{os.path.basename(full)}"\r\nContent-Type: {mime}\r\n\r\n'
        parts.append(head.encode() + data + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts), boundary


def send(url, key, batch):
    body, boundary = encode(batch)
    req = request.Request(
        url.rstrip("/") + "/api/camera-ingest",
        data=body,
        method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}", "X-Camera-Key": key},
    )
    with request.urlopen(req, timeout=120) as resp:
        return json.load(resp)


def main():
    a = parse_args()
    if not a.folder or not a.key:
        print("Both --folder and --key are required (or set ROSIUM_FOLDER and ROSIUM_CAMERA_KEY).", file=sys.stderr)
        return 2
    if not os.path.isdir(a.folder):
        print(f"Folder not found: {a.folder}", file=sys.stderr)
        return 2
    state_path = a.state or os.path.join(os.path.expanduser("~"), ".rosium-camera-state-" + hashlib.sha1(os.path.abspath(a.folder).encode()).hexdigest()[:10] + ".json")
    state = load_state(state_path)
    new = find_new(a.folder, state, a.newer_than_days)
    print(f"{len(new)} new picture(s) in {a.folder}")
    if a.dry_run or not new:
        for full, st, _ in new[:50]:
            print("  would send:", full)
        # Even with nothing to send, say hello so the CRM can tell "quiet" from "down".
        if not a.dry_run and not new:
            try:
                send(a.url, a.key, [])
            except error.HTTPError as e:
                print(f"CRM answered {e.code} — check the key.", file=sys.stderr)
                return 1
            except Exception as e:  # noqa: BLE001
                print(f"Could not reach the CRM: {e}", file=sys.stderr)
                return 1
        return 0

    sent = dup = failed = 0
    for batch in batches(new):
        try:
            result = send(a.url, a.key, batch)
        except error.HTTPError as e:
            if e.code == 401:
                print("The CRM does not accept this key (wrong, rotated, or the camera is switched off).", file=sys.stderr)
                return 1
            print(f"Batch failed ({e.code}); will retry next run.", file=sys.stderr)
            failed += len(batch)
            continue
        except Exception as e:  # noqa: BLE001 - any network problem just means "try again next run"
            print(f"Batch failed ({e}); will retry next run.", file=sys.stderr)
            failed += len(batch)
            continue
        for full, _st, sig in batch:
            state[full] = sig
        save_state(state_path, state)  # after every batch, so a crash loses nothing
        sent += result.get("stored", 0)
        dup += result.get("duplicates", 0)
    print(f"Sent {sent}, already there {dup}, will retry {failed}.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
