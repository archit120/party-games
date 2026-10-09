import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs";
export function ensureDataDir(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}
export function readJSON(file, fallback = {}) {
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : fallback;
}
export function writeJSON(file, value) {
  writeFileSync(`${file}.tmp`, JSON.stringify(value), { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
}
