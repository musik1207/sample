export type StepId = 1 | 2 | 3 | 4 | 5 | 6;

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
  /** 公式試験ガイドの出題目標（日本語訳） */
  objectives?: string[];
}

export interface ExamInfo {
  questions: number | null;
  minutes: number | null;
  /** 合格ライン（%）。公表されていない試験は null */
  passingScore: number | null;
  /** 合格ラインが null のときの表示（例: 非公開） */
  passingNote?: string;
  /** 合格ラインが公表されていない試験で、模擬試験や苦手判定に使う目安（%） */
  targetScore?: number;
  /** 試験中の休憩の回数（休憩の後は前のセクションに戻れない） */
  breaks?: number;
  /** 1 回の休憩の長さ（分） */
  breakMinutes?: number;
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
  /** 画面に出す短い名前（なければ name から「Salesforce Certified」を外したもの） */
  shortName?: string;
  formerName?: string;
  summary: string;
  /** ready: 教材あり / outline: 試験概要のみ */
  status: 'ready' | 'outline';
  exam: ExamInfo;
  domains: Domain[];
  /** 学習時間の目安（時間）と前提 */
  study?: { hours: number; note: string };
  /** レッスンの読み上げ（聞く）を使えるか */
  listen?: boolean;
  /** 初期の受験目標日（ユーザーが設定すると上書き） */
  suggestedTarget?: string;
  links: { label: string; url: string }[];
}

export interface Question {
  id: string;
  domain: string;
  /** single: 1 つ選ぶ / multi: 複数選ぶ / match: 左の項目ごとに右から選ぶ */
  type: 'single' | 'multi' | 'match';
  question: string;
  /** 選択肢。match では右側の候補 */
  choices: string[];
  /** 正解の選択肢インデックス（0 始まり）。match では prompts の順に、対応する choices の番号 */
  answer: number[];
  /** match の左側の項目 */
  prompts?: string[];
  explanation: string;
  refs?: string[];
  /** 公式の試験内容のタスク番号（範囲の中で 1 から） */
  task?: number;
  /** 事例（ケース）問題の ID */
  caseId?: string;
  /** 問題に付ける図（Mermaid） */
  diagram?: string;
}

/** 事例（ケース）問題の本文。複数の問題が同じ事例を使う */
export interface CaseStudy {
  id: string;
  title: string;
  /** 段落は改行で区切る */
  scenario: string;
  diagram?: string;
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
