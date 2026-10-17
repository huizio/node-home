/** 单个定时任务的执行函数签名：无参，可返回 Promise（异步）或同步值。 */
export type TaskFn = () => void | Promise<void>;

/** 新增任务时的可选配置项。 */
export interface AddTaskOptions {
  /** 任务唯一 id；不传时自动生成（需保证唯一，重复会抛错）。 */
  id?: string;
  /** 执行间隔（毫秒），必填。 */
  intervalMs: number;
  /** 是否在 start/调度开始时立即先执行一次，默认 true。 */
  immediate?: boolean;
  /** 最大执行次数；不传表示无限循环执行。 */
  maxRuns?: number;
  /** 任务抛出异常时是否继续后续调度，默认 true；false 时出错即停止该任务。 */
  continueOnError?: boolean;
  /** 每次执行结束后的回调（无论成功失败），可用于日志 / 统计。 */
  onRun?: (result: TaskRunResult) => void;
}

/** 任务单次执行的结果。 */
export interface TaskRunResult {
  /** 任务 id */
  id: string;
  /** 第几次执行（从 1 开始计数） */
  runIndex: number;
  /** 是否执行成功 */
  ok: boolean;
  /** 失败时的错误对象 */
  error?: unknown;
  /** 本次执行耗时（毫秒） */
  durationMs: number;
  /** 执行开始时的本地时间戳（Date.now()） */
  timestamp: number;
}

/** 已注册任务的内部描述（含默认值补全后的完整配置）。 */
export interface RegisteredTask {
  /** 任务唯一 id */
  id: string;
  /** 要周期执行的任务函数 */
  fn: TaskFn;
  /** 执行间隔（毫秒） */
  intervalMs: number;
  /** 调度开始时是否立即执行一次 */
  immediate: boolean;
  /** 最大执行次数；undefined 表示无限次 */
  maxRuns?: number;
  /** 出错时是否继续调度 */
  continueOnError: boolean;
  /** 每次执行结束后的回调 */
  onRun?: (result: TaskRunResult) => void;
}

/** 任务列表查询返回的单条摘要信息。 */
export interface TaskSummary {
  /** 任务 id */
  id: string;
  /** 执行间隔（毫秒） */
  intervalMs: number;
  /** 已执行次数 */
  runCount: number;
  /** 是否正在执行中（防重叠标记） */
  running: boolean;
}
