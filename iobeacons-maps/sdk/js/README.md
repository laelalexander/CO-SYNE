# IoBeacons API client for JavaScript

One file, no dependencies. Works in Node 18+, Deno, Bun and browsers.

```js
import { IoBeacons } from './iobeacons.mjs';

const io = new IoBeacons(process.env.IOBEACONS_API_KEY);

await io.sendPositions('truck-12', { lon: -95.99, lat: 36.15, speed_mph: 34 });
const maps = await io.listMaps();
const iss = await io.satellitePosition(25544);       // { lon, lat, altKm, speedKmS, ... }
const path = await io.satelliteTrack(25544, { minutes: 90 });
console.log(io.quota);                               // { limit, remaining, period }
```

Every endpoint has a method; the names match the reference at
https://iobeacons.com/developers/api/. Failed calls throw `IoBeaconsError` with
`status` and a `message` you can show to a person. Busy (429) and gateway
errors are retried twice. `io.request(method, path, { body, query })` calls
anything else.

This file is generated from the API description (`npm run build` in the
iobeacons-maps repo); don't edit it by hand.
