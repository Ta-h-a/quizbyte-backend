import { createServer } from "http";
import { Server } from "socket.io";
const PORT = process.env.PORT || 8080;
import { subscribeInitialEvents } from "./events.js";

const httpServer = createServer();

const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

subscribeInitialEvents(io);

httpServer.listen(process.env.PORT, () => {
  console.log(`Server is running on port ${process.env.PORT}`);
});
