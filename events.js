import Exam from "./classes/Exam.js";

// import cookie from "cookie";
export const rooms = new Map();

export function subscribeInitialEvents(io) {
  if (!io) throw new Error("No io provided");
  io.on("connection", (socket) => {
    console.log({
      socket,
      s: socket.handshake.auth?.proctorToken,
    });
    // TODO
    // ProctorToken
    // StudentToken
    // TODO
    // if both of these tokens are not there, then don't subscribe with events and just emit a event saying not authorized

    // 'start-room', because if someone wants to create a room, they can,and for those who want to join, they can as well
    const proctorToken = socket.handshake.auth?.proctorToken || "";
    const studentToken = socket.handshake.auth?.studentToken || "";

    if (!proctorToken) {
      if (!studentToken) socket.disconnect();
    }

    if (proctorToken == "maliksir123") {
      // subscribe the socket to proctor events
      socket.on(
        "create-exam",
        ({ uuid: roomId, images, answers, examDuration, joinTime }) => {
          if (!roomId || !images || !answers || !examDuration || !joinTime) {
            socket.emit("clientError", "Invalid data");
            return;
          }
          if (!rooms.has(roomId)) {
            const existingRoom = Array.from(rooms.entries()).find(
              ([_, value]) => value.examHost === socket.id
            );
            if (existingRoom) {
              socket.emit("room-deleted");
              socket.leave(existingRoom[0]);
              // TODO: Broadcast to everyone before we delete the room that proctor is creating a new room so we need to delete this one.
              io.to(existingRoom[0]).emit("exam-cancelled");
              io.socketsLeave(existingRoom[0]);
              rooms.delete(existingRoom[0]);
            }
            socket.join(roomId);
            const exam = new Exam(roomId, socket.id, io);
            rooms.set(roomId, exam);
            exam.setupExam(images, answers, examDuration, joinTime, socket);
            exam.setUpListeners(socket);
            exam.setupProctorListeners(socket);

            // Start decreasing the time by 1 sec for join time.
            exam.startJoining();
          }
        }
      );
    }

    if (studentToken == "student123") {
      // subscribe the socket to student events

      // Use this here as well, as they are common listeners
      socket.on("join-exam", ({ examId, username }) => {
        if (!examId) socket.emit("clientError", "ExamId is required");
        if (!username) socket.emit("clientError", "Username is required");

        if (!rooms.has(examId)) socket.emit("clientError", "Exam not found");

        const exam = rooms.get(examId);
        if (exam == undefined) socket.emit("clientError", "Exam not found");
        if (exam.examStatus === "in-progress")
          socket.emit("clientError", "Exam is in progress");
        if (exam.examStatus !== "waiting-for-participants")
          socket.emit("clientError", "Exam is not available");

        // If the one who wants to join the room
        if (
          exam.participants.some(
            (participant) =>
              participant?.id === socket.id ||
              participant?.username === username
          )
        )
          socket.emit("clientError", "Participant already added");

        exam.setUpListeners(socket);
        exam.setupStudentListeners(socket);

        exam.io.to(exam.examHost).emit("participant-request", {
          id: socket.id,
          username,
        });

        // TODO Logic to telling the user that they have to wait
        // This is just a event that is used to send back the join time of the room when the request is made, so that the student knows how much time he can wait.
        socket.emit("waiting-to-be-accepted", exam.joinTime);
      });
    }

    socket.on("verify-room", (roomId) => {
      if (!roomId) socket.emit("clientError", "Invalid roomId");
      socket.emit("room-exists", rooms.has(roomId));
      socket.emit("room-status", {
        roomStatus: rooms.has(roomId)?.examStatus,
        roomId,
        isProctor: rooms.has(roomId)?.examHost == socket.id,
      });
    });

    // socket.on("disconnect", () => {
    //   socket.emit()
    // });
  });
}
