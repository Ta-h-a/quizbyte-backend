import { rooms } from "../events.js";

export default class Exam {
  questions; // images url in []
  answers; // answers in []
  duration; // duration for the exam
  joinTime; // time limit for joining
  examStatus;
  examId;
  participants;
  examHost;
  io;

  constructor(id, host, io) {
    this.examId = id;
    this.examHost = host;
    this.questions = [];
    this.answers = [];
    this.duration = 0;
    this.joinTime = 0;
    this.participants = [];
    this.examStatus = "not-started";
    this.io = io;
    this.initialDuration = 0;
  }

  setupExam(images, answers, examDuration, joinTime, socket) {
    if (!images || !answers || !examDuration || !joinTime)
      socket.emit("error", "Invalid exam details");

    this.questions = images;
    this.answers = answers;
    this.duration = examDuration * 18;
    this.joinTime = joinTime * 15;
    this.examStatus = "waiting-for-participants";
    this.participants.push(socket.id);
    this.initialDuration = examDuration * 60;
    socket.emit("setupSuccess", "Exam setup successful");
  }

  setUpListeners(socket) {
    socket.on("get-present-join-time", () => {
      if (this.examStatus !== "waiting-for-participants")
        socket.emit("clientError", "Exam is not available");
      socket.emit("present-join-time", this.joinTime);
    });
  }

  startJoining() {
    let countdown = setInterval(() => {
      if (this.joinTime <= 0) {
        clearInterval(countdown);

        this.examStatus = "in-progress";
        this.startExam();
      } else {
        this.joinTime--;
      }
    }, 1000);
  }

  startExam() {
    let countdown = setInterval(() => {
      if (this.duration <= 0) {
        clearInterval(countdown);
        // TODO : Logic for ending the exam
        this.examStatus = "completed";

        // this tells students to submit their answers by calling verify-answers
        this.io.to(this.examId).except(this.examHost).emit("exam-completed");
        this.io.socketsLeave(this.examId);
      } else {
        if (this.duration == 10) {
          this.io
            .to(this.examId)
            .except(this.examHost)
            .emit("inform-students-about-exam");
        }
        this.duration--;
      }
    }, 1000);
  }

  setupStudentListeners(socket) {
    socket.on("verify-student", () => {
      socket.emit(
        "student-verified",
        this.participants.find((participant) => participant.id == socket.id) !=
          undefined
          ? true
          : false
      );
    });

    socket.on("can-sit-for-exam", (roomId) => {
      if (roomId !== this.examId) return;
      if (this.examStatus !== "in-progress")
        socket.emit("error", "Exam has either finished or not started yet");
      socket.emit("can-sit", {
        duration: this.duration,
        questions: this.questions, // images
        questionsCount: this.answers.length,
      });
    });

    socket.on("verify-answers", (answers) => {
      if (!answers) socket.emit("clientError", "Answers are required");
      if (this.examStatus !== "in-progress" || this.examStatus == "completed")
        socket.emit("error", "Exam has either finished or not started yet");
      if (this.participants.find((p) => p.id == socket.id) == undefined) {
        return socket.emit(
          "clientError",
          "You are not a participant of this exam"
        );
      }

      const correctAnswersMap = new Map(
        this.answers.map((answer) => [answer.id, answer.answer])
      );
      const userCorrectAnswers = answers.filter(
        (answer) =>
          answer.attempted && answer.answer === correctAnswersMap.get(answer.id)
      );

      socket.emit("answers-verified", {
        userCorrectAnswers,
        roomId: this.examId,
      });
      this.io
        .to(this.examId)
        .emit(
          "paper-finished",
          this.participants.find((p) => p.id == socket.id)?.username
        );
      this.io.sockets.sockets
        .get(this.examHost)
        .emit("student-time-taken-to-finish-exam", {
          id: socket.id,
          timeTaken: this.initialDuration - this.duration,
        });
      this.participants = this.participants.filter(
        (participant) => participant.id !== socket.id
      );
      socket.leave(this.examId);
    });
  }

  setupProctorListeners(socket) {
    socket.on("remove-participant-from-queue", (id) => {
      this.io.sockets.sockets.get(id).emit("participant-removed-from-queue");
    });
    // socket.on(
    //   "verify-participant-in-queue",
    //   ({ id, username, isParticipantInQueue: isInQueue }) => {
    //     if (this.examStatus !== "waiting-for-participants") return;
    //     const participantSocket = this.io.sockets.sockets.get(id);
    //     participantSocket?.emit("in-queue", { username, isInQueue });
    //   }
    // );

    socket.on("add-group-of-participants", (participants) => {
      // console.log({
      //   newParticipants: participants,
      //   roomContainingParticipants: this.participants,
      // });

      if (this.examStatus !== "waiting-for-participants")
        socket.emit("clientError", "Exam is not available");
      let totalParticipants = this.participants.concat(participants);
      this.participants = [];
      totalParticipants.forEach((participant) => {
        const participantSocket = this.io.sockets.sockets.get(participant?.id);
        if (participantSocket) {
          this.participants.push(participant);
          participantSocket.join(this.examId);
          participantSocket.emit("participant-verified", this.examId);
        }
      });

      socket.emit("group-of-participants-added");
    });

    socket.on("ensure-exam-started", () => {
      if (this.examStatus !== "in-progress")
        socket.emit("error", "Exam has either finished or not started yet");
      socket.emit("exam-started", {
        duration: this.duration,
        participants: this.participants,
      });
    });

    socket.on("verify-proctor", (roomId) => {
      socket.emit("proctor-verified", rooms.get(roomId)?.examHost == socket.id);
    });

    socket.on("add-participant", ({ id, username }) => {
      if (!id) socket.emit("clientError", "Id is required");
      if (!username) socket.emit("clientError", "Username is required");
      if (this.examStatus !== "waiting-for-participants")
        socket.emit("clientError", "Exam is not available");
      if (socket.id !== this.examHost)
        socket.emit("clientError", "Only the host can add participants");
      if (
        this.participants.some(
          (participant) =>
            participant?.id === id || participant?.username === username
        )
      ) {
        return socket.emit("clientError", "Participant already added");
      }

      // Try to find a way to join the socket to the room, because this socket is of admin, and we need socket of user.
      const participantSocket = this.io.sockets.sockets.get(id);
      if (!participantSocket)
        socket.emit("clientError", "Participant not found");

      this.participants.push({ id, username });
      console.log(participantSocket);
      participantSocket.join(this.examId);

      participantSocket.emit("participant-verified", this.examId);
      socket.emit("participant-added", { id, username });
      // console.log(this.participants);
    });

    socket.on("remove-participant", ({ id, username }) => {
      if (!id) socket.emit("clientError", "Id is required");
      if (!username) socket.emit("clientError", "Username is required");
      if (
        this.examStatus !== "waiting-for-participants" ||
        this.examStatus !== "in-progress"
      )
        socket.emit("clientError", "Exam is not available");
      if (socket.id !== this.examHost)
        socket.emit("clientError", "Only the host can remove participants");

      const participantSocket = this.io.sockets.sockets.get(id);
      if (
        this.participants.some(
          (participant) =>
            participant?.id === id || participant?.username === username
        )
      ) {
        if (!participantSocket) {
          return socket.emit("clientError", "Participant not found");
        }
      } else {
        return socket.emit("clientError", "Participant not found");
      }
      this.participants = this.participants.filter(
        (participant) =>
          participant.id !== id && participant.username !== username
      );

      participantSocket.leave(this.examId);

      socket.emit("participant-removed", { id, username });
      participantSocket.emit("removed-from-exam");
    });
  }
}
