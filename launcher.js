import { fileURLToPath } from "node:url";
const game = process.env.GAME || "undercover";
if (!["secret-hitler", "coup", "undercover"].includes(game))
  throw Error("Unknown GAME");
process.chdir(fileURLToPath(new URL(`./apps/${game}/`, import.meta.url)));
await import(`./apps/${game}/server.js`);
