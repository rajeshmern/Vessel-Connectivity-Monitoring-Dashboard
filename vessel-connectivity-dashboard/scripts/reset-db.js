// Deletes the local SQLite database so the next start re-seeds from scratch.
import fs from 'node:fs';
import { config } from '../server/config.js';

for (const suffix of ['', '-wal', '-shm']) {
  const file = config.dbPath + suffix;
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
    console.log(`removed ${file}`);
  }
}
