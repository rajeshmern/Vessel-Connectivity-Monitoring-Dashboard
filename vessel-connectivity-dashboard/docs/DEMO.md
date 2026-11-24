# Demo script (about 7 minutes)

Start fresh: `npm run reset && npm start`, open http://localhost:3000.

**1. Overview (1 min)**
- Total, online, degraded, offline and 24 h availability at the top. The thin bar under the tiles is the fleet split.
- Fleet health chart: change 6 h / 24 h / 7 d, hover a bar.
- Active alerts on the right, worst first. Technology and provider tables below.
- Click the red **Offline** tile: it opens the vessel list already filtered, and the filter is in the URL.

**2. Vessel list (1.5 min)**
- Offline first by default. Search "meridian", filter by provider and technology, sort by latency.
- Offline vessels show dashes, not zeros (no data, not zero speed).
- **Add vessel** with an empty form to show validation, then an invalid IMO (1234568 fails), then a valid one (9074729).

**3. Vessel detail (2 min)**
- Open Atlantic Beacon. Status timeline, availability, incidents, time offline.
- Switch ranges. The dashed line on latency and packet loss is that technology's limit.
- Open a degraded vessel: the metric outside its limit is highlighted in the readings.

**4. Live alert (1.5 min)**
- Open any online vessel, click **Take offline**. Status flips, sidebar counter goes up.
- Go to **Alerts**, acknowledge it, go back and click **Restore**. The alert moves to Resolved.
- Pause and resume the simulator from the sidebar.

**5. Code and architecture (1 min)**
- `server/domain/classify.js` and `technologies.js`: the one place that decides status.
- `server/services/ingest.js`: every reading goes through here, in one transaction.
- `server/db/schema.sql`: the partial unique index on open alerts.
- `npm test`.
