"""IoBeacons API client 1.0.0. Generated from the API description; do not edit by hand.

Docs: https://iobeacons.com/developers/api/
Needs only the Python standard library (3.8+).

    from iobeacons import IoBeacons
    io = IoBeacons("iobm_...")          # or set IOBEACONS_API_KEY
    io.send_positions("truck-12", {"lon": -95.99, "lat": 36.15, "speed_mph": 34})
    iss = io.satellite_position(25544)
"""
import json
import mimetypes
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

__version__ = "1.0.0"
__all__ = ["IoBeacons", "IoBeaconsError"]


def _q(v):
    return urllib.parse.quote(str(v), safe="")


class IoBeaconsError(Exception):
    """Raised for any answer that is not a success. str(e) is safe to show a person."""

    def __init__(self, status, message, body=None):
        super().__init__(message)
        self.status = status
        self.body = body


class IoBeacons:
    """A client for the IoBeacons API. Create a key in Maps under Settings, API keys."""

    def __init__(self, api_key=None, base_url="https://iobeacons.com/maps/api/v1", retries=2, timeout=30):
        api_key = api_key or os.environ.get("IOBEACONS_API_KEY")
        if not api_key or not api_key.startswith("iobm_"):
            raise ValueError("IoBeacons: pass your API key (it starts with iobm_) or set IOBEACONS_API_KEY.")
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.retries = retries
        self.timeout = timeout
        self.quota = None  # {"limit", "remaining", "period"} from the last answer

    def request(self, method, path, body=None, query=None, raw=False, data=None, content_type=None):
        """Call any endpoint. path is relative to the API root, for example "/maps"."""
        url = self.base_url + path
        if query:
            q = {k: v for k, v in query.items() if v is not None}
            if q:
                url += "?" + urllib.parse.urlencode(q)
        headers = {"Authorization": "Bearer " + self.api_key, "X-Client": "iobeacons-python/" + __version__, "Accept": "application/json"}
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        elif content_type:
            headers["Content-Type"] = content_type
        attempt = 0
        while True:
            req = urllib.request.Request(url, data=data, method=method, headers=headers)
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as res:
                    self._quota(res.headers)
                    payload = res.read()
                    if raw:
                        return payload
                    if "json" in (res.headers.get("Content-Type") or ""):
                        return json.loads(payload.decode("utf-8"))
                    return payload.decode("utf-8")
            except urllib.error.HTTPError as e:
                self._quota(e.headers)
                retry = e.code in (429, 502, 503) and attempt < self.retries and (method == "GET" or e.code == 429) and e.headers.get("X-Quota-Remaining") != "0"
                if retry:
                    time.sleep(2 ** attempt)
                    attempt += 1
                    continue
                try:
                    detail = json.loads(e.read().decode("utf-8"))
                except Exception:
                    detail = None
                message = (detail or {}).get("error") or "IoBeacons answered %d" % e.code
                raise IoBeaconsError(e.code, message, detail) from None
            except urllib.error.URLError as e:
                if method == "GET" and attempt < self.retries:
                    time.sleep(0.5 * 2 ** attempt)
                    attempt += 1
                    continue
                raise IoBeaconsError(0, "Could not reach IoBeacons: %s" % e.reason) from None

    def _quota(self, headers):
        if headers and headers.get("X-Quota-Limit"):
            self.quota = {"limit": int(headers["X-Quota-Limit"]), "remaining": int(headers.get("X-Quota-Remaining") or 0), "period": headers.get("X-Quota-Period")}

    def _upload(self, path, file_path, name=None):
        boundary = uuid.uuid4().hex
        filename = os.path.basename(file_path)
        ctype = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        with open(file_path, "rb") as f:
            content = f.read()
        parts = []
        if name:
            parts.append(('--%s\r\nContent-Disposition: form-data; name="name"\r\n\r\n%s\r\n' % (boundary, name)).encode("utf-8"))
        parts.append(('--%s\r\nContent-Disposition: form-data; name="file"; filename="%s"\r\nContent-Type: %s\r\n\r\n' % (boundary, filename, ctype)).encode("utf-8"))
        parts.append(content + ("\r\n--%s--\r\n" % boundary).encode("utf-8"))
        return self.request("POST", path, data=b"".join(parts), content_type="multipart/form-data; boundary=" + boundary)

    def me(self):
        """Who this key belongs to. GET /me"""
        return self.request("GET", f"/me")

    def usage(self):
        """Usage this month. GET /usage"""
        return self.request("GET", f"/usage")

    def list_maps(self):
        """List maps. GET /maps"""
        return self.request("GET", f"/maps")

    def create_map(self, body):
        """Create a map. POST /maps"""
        return self.request("POST", f"/maps", body=body)

    def get_map(self, id):
        """Get a map with its layers. GET /maps/{id}"""
        return self.request("GET", f"/maps/{_q(id)}")

    def update_map(self, id, body):
        """Change a map. PATCH /maps/{id}"""
        return self.request("PATCH", f"/maps/{_q(id)}", body=body)

    def delete_map(self, id):
        """Delete a map. DELETE /maps/{id}"""
        return self.request("DELETE", f"/maps/{_q(id)}")

    def duplicate_map(self, id):
        """Copy a map. POST /maps/{id}/duplicate"""
        return self.request("POST", f"/maps/{_q(id)}/duplicate")

    def reset_share_link(self, id):
        """Make a new share link. POST /maps/{id}/share/reset"""
        return self.request("POST", f"/maps/{_q(id)}/share/reset")

    def upload_file(self, id, file_path, name=None):
        """Upload a file as a new layer. POST /maps/{id}/upload"""
        return self._upload(f"/maps/{_q(id)}/upload", file_path, name)

    def create_layer(self, id, body):
        """Add a layer. POST /maps/{id}/layers"""
        return self.request("POST", f"/maps/{_q(id)}/layers", body=body)

    def update_layer(self, id, body):
        """Change a layer. PATCH /layers/{id}"""
        return self.request("PATCH", f"/layers/{_q(id)}", body=body)

    def delete_layer(self, id):
        """Delete a layer. DELETE /layers/{id}"""
        return self.request("DELETE", f"/layers/{_q(id)}")

    def export_layer(self, id, format):
        """Download a layer. GET /layers/{id}/export.{format}"""
        return self.request("GET", f"/layers/{_q(id)}/export.{_q(format)}", raw=True)

    def layer_tile(self, layer_id, z, x, y):
        """Vector tiles. GET /tiles/{layerId}/{z}/{x}/{y}.pbf"""
        return self.request("GET", f"/tiles/{_q(layer_id)}/{_q(z)}/{_q(x)}/{_q(y)}.pbf", raw=True)

    def list_features(self, id, bbox=None):
        """Read features. GET /layers/{id}/features"""
        return self.request("GET", f"/layers/{_q(id)}/features", query={"bbox": bbox})

    def add_features(self, id, body):
        """Add features. POST /layers/{id}/features"""
        return self.request("POST", f"/layers/{_q(id)}/features", body=body)

    def update_feature(self, id, body):
        """Change a feature. PATCH /features/{id}"""
        return self.request("PATCH", f"/features/{_q(id)}", body=body)

    def delete_feature(self, id):
        """Delete a feature. DELETE /features/{id}"""
        return self.request("DELETE", f"/features/{_q(id)}")

    def list_sites(self):
        """List sites. GET /sites"""
        return self.request("GET", f"/sites")

    def create_site(self, body):
        """Add a site. POST /sites"""
        return self.request("POST", f"/sites", body=body)

    def update_site(self, id, body):
        """Change a site. PATCH /sites/{id}"""
        return self.request("PATCH", f"/sites/{_q(id)}", body=body)

    def delete_site(self, id):
        """Delete a site. DELETE /sites/{id}"""
        return self.request("DELETE", f"/sites/{_q(id)}")

    def list_zones(self):
        """List zones. GET /zones"""
        return self.request("GET", f"/zones")

    def create_zone(self, body):
        """Add a zone. POST /zones"""
        return self.request("POST", f"/zones", body=body)

    def update_zone(self, id, body):
        """Change a zone. PATCH /zones/{id}"""
        return self.request("PATCH", f"/zones/{_q(id)}", body=body)

    def delete_zone(self, id):
        """Delete a zone. DELETE /zones/{id}"""
        return self.request("DELETE", f"/zones/{_q(id)}")

    def list_devices(self):
        """List devices. GET /devices"""
        return self.request("GET", f"/devices")

    def create_device(self, body):
        """Add a device. POST /devices"""
        return self.request("POST", f"/devices", body=body)

    def delete_device(self, id):
        """Delete a device. DELETE /devices/{id}"""
        return self.request("DELETE", f"/devices/{_q(id)}")

    def send_positions(self, ref, body):
        """Send positions. POST /devices/{ref}/positions"""
        return self.request("POST", f"/devices/{_q(ref)}/positions", body=body)

    def device_track(self, id, hours=None):
        """A device's trail. GET /devices/{id}/track"""
        return self.request("GET", f"/devices/{_q(id)}/track", query={"hours": hours})

    def list_rules(self):
        """List alert rules. GET /rules"""
        return self.request("GET", f"/rules")

    def create_rule(self, body):
        """Add an alert rule. POST /rules"""
        return self.request("POST", f"/rules", body=body)

    def update_rule(self, id, body):
        """Change an alert rule. PATCH /rules/{id}"""
        return self.request("PATCH", f"/rules/{_q(id)}", body=body)

    def delete_rule(self, id):
        """Delete an alert rule. DELETE /rules/{id}"""
        return self.request("DELETE", f"/rules/{_q(id)}")

    def list_alerts(self):
        """Recent alerts. GET /alerts"""
        return self.request("GET", f"/alerts")

    def create_report(self, body):
        """Make a site report. POST /reports"""
        return self.request("POST", f"/reports", body=body)

    def list_reports(self):
        """List reports. GET /reports"""
        return self.request("GET", f"/reports")

    def get_report(self, id):
        """Get a report. GET /reports/{id}"""
        return self.request("GET", f"/reports/{_q(id)}")

    def report_pdf(self, id):
        """Download a report as PDF. GET /reports/{id}/pdf"""
        return self.request("GET", f"/reports/{_q(id)}/pdf", raw=True)

    def list_catalog(self):
        """List live data layers. GET /catalog"""
        return self.request("GET", f"/catalog")

    def catalog_data(self, key, bbox=None):
        """Read a live data layer. GET /catalog/{key}/data"""
        return self.request("GET", f"/catalog/{_q(key)}/data", query={"bbox": bbox})

    def geocode(self, q=None):
        """Look up an address. GET /geocode"""
        return self.request("GET", f"/geocode", query={"q": q})

    def space_groups(self):
        """List satellite groups. GET /space"""
        return self.request("GET", f"/space")

    def space_group(self, group):
        """Orbital elements for a group. GET /space/{group}"""
        return self.request("GET", f"/space/{_q(group)}")

    def space_group_positions(self, group, time=None):
        """Where a whole group is. GET /space/{group}/positions"""
        return self.request("GET", f"/space/{_q(group)}/positions", query={"time": time})

    def satellite_position(self, norad, time=None):
        """Where one object is. GET /space/objects/{norad}/position"""
        return self.request("GET", f"/space/objects/{_q(norad)}/position", query={"time": time})

    def satellite_track(self, norad, time=None, minutes=None, step=None):
        """Ground track. GET /space/objects/{norad}/track"""
        return self.request("GET", f"/space/objects/{_q(norad)}/track", query={"time": time, "minutes": minutes, "step": step})

    def satellite_info(self, norad):
        """Catalogue record. GET /space/info/{norad}"""
        return self.request("GET", f"/space/info/{_q(norad)}")

    def radar_frames(self, source=None):
        """Radar loop frames. GET /weather/radar-frames"""
        return self.request("GET", f"/weather/radar-frames", query={"source": source})

    def doppler(self, lon=None, lat=None):
        """Doppler winds near a point. GET /weather/doppler"""
        return self.request("GET", f"/weather/doppler", query={"lon": lon, "lat": lat})

    def list_notes(self, map_id=None, norad=None):
        """List notes. GET /notes"""
        return self.request("GET", f"/notes", query={"map_id": map_id, "norad": norad})

    def create_note(self, body):
        """Add a note. POST /notes"""
        return self.request("POST", f"/notes", body=body)

    def update_note(self, id, body):
        """Change a note. PATCH /notes/{id}"""
        return self.request("PATCH", f"/notes/{_q(id)}", body=body)

    def delete_note(self, id):
        """Delete a note. DELETE /notes/{id}"""
        return self.request("DELETE", f"/notes/{_q(id)}")

    def list_findings(self):
        """List findings. GET /findings"""
        return self.request("GET", f"/findings")

    def create_finding(self, body):
        """Save a finding. POST /findings"""
        return self.request("POST", f"/findings", body=body)

    def update_finding(self, id, body):
        """Change a finding. PATCH /findings/{id}"""
        return self.request("PATCH", f"/findings/{_q(id)}", body=body)

    def delete_finding(self, id):
        """Delete a finding. DELETE /findings/{id}"""
        return self.request("DELETE", f"/findings/{_q(id)}")
