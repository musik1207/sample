export type StepId = 1 | 2 | 3 | 4 | 5;

export interface Step {
  id: StepId;
  title: string;
  subtitle: string;
}

export interface Domain {
  id: string;
  name: string;
  nameEn: string;
  /** 配点（%）。未確定の場合は null */
  weight: number | null;
}

export interface ExamInfo {
  questions: number | null;
  minutes: number | null;
  /** 合格ライン（%） */
  passingScore: number | null;
  fee: string | null;
  retakeFee: string | null;
  prerequisite: string;
  /** 公式ガイドと突き合わせ済みかどうか */
  verified: boolean;
  /** 情報の確認日（YYYY-MM-DD） */
  checkedAt: string;
  notes: string[];
}

export interface Cert {
  id: string;
  step: StepId;
  order: number;
  name: string;
  formerName?: string;
  summary: string;
  /** ready: 教材あり / outline: 試験概要のみ */
  status: 'ready' | 'outline';
  exam: ExamInfo;
  domains: Domain[];
  /** 初期の受験目標日（ユーザーが設定すると上書き） */
  suggestedTarget?: string;
  links: { label: string; url: string }[];
}

export interface Question {
  id: string;
  domain: string;
  type: 'single' | 'multi';
  question: string;
  choices: string[];
  /** 正解の選択肢インデックス（0 始まり） */
  answer: number[];
  explanation: string;
  refs?: string[];
}

/** クライアントに渡す問題（資格 ID 付き） */
export interface QuizQuestion extends Question {
  certId: string;
}

export interface GlossaryTerm {
  term: string;
  reading?: string;
  description: string;
  certs: string[];
  tags?: string[];
}
