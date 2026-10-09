import { addChat } from "./chat.js";
import * as ai from "./ai.js";
import * as game from "./game.js";
import { startRoomServer } from "../../packages/core/room-server.js";
startRoomServer({
  game,
  ai,
  addChat,
  title: "Undercover",
  publicDir: new URL("./public/", import.meta.url),
});
