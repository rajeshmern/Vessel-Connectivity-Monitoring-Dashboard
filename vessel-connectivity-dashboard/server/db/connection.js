import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA_FILE = path.join(import.meta.dirname, 'schema.sql');

 

const plain = (row) => (row ? { ...row } : row);

function wrapStatement(statement) {
  return {
    run: (...args) => statement.run(...args),
    get: (...args) => plain(statement.get(...args)),
    all: (...args) => statement.all(...args).map(plain),
  };
}

export function isUniqueViolation(err) {
  return err?.errcode === 2067 || /UNIQUE constraint failed/.test(err?.message ?? '');
}

export function openDatabase(file) {
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const raw = new DatabaseSync(file);
  // NORMAL is the recommended pairing with WAL: still crash-safe, far fewer fsyncs.
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');
  raw.exec(fs.readFileSync(SCHEMA_FILE, 'utf8'));

  let depth = 0;

  return {
    exec: (sql) => raw.exec(sql),
    prepare: (sql) => wrapStatement(raw.prepare(sql)),
    close: () => raw.close(),

    transaction(fn) {
      return (...args) => {
        const outer = depth === 0;
        const savepoint = `sp_${depth}`;
        raw.exec(outer ? 'BEGIN' : `SAVEPOINT ${savepoint}`);
        depth += 1;
        try {
          const result = fn(...args);
          depth -= 1;
          raw.exec(outer ? 'COMMIT' : `RELEASE ${savepoint}`);
          return result;
        } catch (err) {
          depth -= 1;
          raw.exec(outer ? 'ROLLBACK' : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
          throw err;
        }
      };
    },
  };
}
