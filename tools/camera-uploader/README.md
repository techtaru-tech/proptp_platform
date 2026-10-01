# Camera uploader

Pushes the pictures your 4G camera saves on a PC to the Rosium CRM, so they appear under **Site Cameras**.

## One-time setup
1. In the CRM: **Site Cameras → Add camera**. Copy the **camera key** it shows (it is shown once).
2. On the PC, install **Python 3** if it is not there (`python3 --version`). Nothing else is needed.
3. Copy `upload_photos.py` somewhere on the PC.
4. Try it once by hand (`--dry-run` lists what it would send and sends nothing):

```
python3 upload_photos.py --folder "D:/CameraPhotos" --key rck_xxxxxxxx --dry-run
python3 upload_photos.py --folder "D:/CameraPhotos" --key rck_xxxxxxxx
```

On the first run it sends only pictures from the last 7 days (change with `--newer-than-days`), not years of history.

## Run it every hour

**Mac / Linux** — `crontab -e`, add:
```
0 * * * * /usr/bin/python3 /path/to/upload_photos.py --folder "/path/to/photos" --key rck_xxxxxxxx >> ~/rosium-camera.log 2>&1
```

**Windows** — Task Scheduler → Create Basic Task → Daily → repeat every 1 hour → action *Start a program*:
- Program: `python`
- Arguments: `C:\path\upload_photos.py --folder "D:\CameraPhotos" --key rck_xxxxxxxx`

## Good to know
- A picture that fails to send is retried on the next run. Sending the same picture twice is harmless.
- Even when there is nothing new, each run checks in, so the CRM can tell a camera that is quiet from a PC that is off.
- The CRM marks a camera **Offline** when nothing has arrived for three times the interval you set for it.
- If the key stops working (lost PC, new person), use **Rotate key** on the camera in the CRM, then put the new key in the job. The old one stops working immediately.
- Use `--url` if your CRM is not at `https://console.rosium.in`.
