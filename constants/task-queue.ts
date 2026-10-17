/** 任务队列默认配置：用于 add 时未显式传入的可选项（避免业务代码里硬编码布尔值）。 */
export const TASK_DEFAULTS = {
  /** start / 调度开始时是否立即执行一次 */
  IMMEDIATE: true,
  /** 任务出错时是否继续调度 */
  CONTINUE_ON_ERROR: true,
} as const;

/** 自动生成任务 id 的前缀。 */
export const AUTO_TASK_ID_PREFIX = "task" as const;

/** 单次执行允许的最小间隔（毫秒），避免误传 0 导致空转。 */
export const TASK_MIN_INTERVAL_MS = 10 as const;
