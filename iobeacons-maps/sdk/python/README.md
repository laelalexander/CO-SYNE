# IoBeacons API client for Python

One file, standard library only, Python 3.8+.

```python
from iobeacons import IoBeacons   # copy iobeacons.py next to your script

io = IoBeacons("iobm_...")          # or set IOBEACONS_API_KEY

io.send_positions("truck-12", {"lon": -95.99, "lat": 36.15, "speed_mph": 34})
maps = io.list_maps()
iss = io.satellite_position(25544)  # {"lon", "lat", "altKm", "speedKmS", ...}
track = io.satellite_track(25544, minutes=90)
io.upload_file(map_id, "depots.csv", name="Depots")
print(io.quota)                     # {"limit", "remaining", "period"}
```

Every endpoint has a method in snake_case; the names match the reference at
https://iobeacons.com/developers/api/. Failed calls raise `IoBeaconsError` with
`status` and a message you can show to a person.

This file is generated from the API description; don't edit it by hand.
