import * as game from "./game.js";
import { startRoomServer } from "../../packages/core/room-server.js";
startRoomServer({
  game,
  title: "Undercover",
  publicDir: new URL("./public/", import.meta.url),
});
