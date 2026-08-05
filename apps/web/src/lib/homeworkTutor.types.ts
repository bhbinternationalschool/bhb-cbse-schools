export type HomeworkTutorContext = {
  childName?: string;
  className?: string;
  subjectLabel?: string;
  homeworkTitle?: string;
  homeworkBody?: string;
};

export type HomeworkTutorTurn = {
  role: "user" | "assistant";
  content: string;
};
