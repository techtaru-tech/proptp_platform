# Cloud gateway (no device at the site)

go2rtc runs on the CRM server (pm2) and pulls each camera through the site router's port-forward.
Nothing is installed at the site; only the router forwards one TCP port per camera to the camera's RTSP port 554.

1. Site: change the camera password; router forwards e.g. 8554 -> 192.168.x.x:554. Restrict the rule to the
   server IP 65.2.106.176 if the router allows it.
2. Server: install go2rtc to ~/go2rtc, copy go2rtc.yaml.example to go2rtc.yaml and fill it in,
   `pm2 start ./go2rtc --name go2rtc -- -config go2rtc.yaml`, add nginx-stream.conf.example with a long random token.
3. CRM: camera live address = https://<your-crm-domain>/<token>/stream.html?src=delhi1&mode=mse
