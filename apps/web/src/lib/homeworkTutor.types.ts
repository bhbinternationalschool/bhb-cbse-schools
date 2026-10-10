export type HomeworkTutorContext = {
  childName?: string;
  className?: string;
  subjectLabel?: string;
  homeworkTitle?: string;
  homeworkBody?: string;
  /**
   * Asked in the middle of something else (the revision drill): answer it
   * fully, whatever it is about, like a search engine — see
   * buildTutorSystemPrompt.
   */
  openQuestion?: boolean;
};

export type HomeworkTutorTurn = {
  role: "user" | "assistant";
  content: string;
};
