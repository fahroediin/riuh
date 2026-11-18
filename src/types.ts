export type QType = 'tf' | 'pick';
/** tf: a = Benar, b = Salah */
export type Choice = 'a' | 'b';

export interface Question {
  type: QType;
  text: string;
  a: string;
  b: string;
  answer: Choice | null;
  timeSec: number;
}

export interface QuestionSet {
  id: string;
  title: string;
  questions: Question[];
}
