import { randomUUID } from "node:crypto";
import { AUTO_TASK_ID_PREFIX, TASK_DEFAULTS, TASK_MIN_INTERVAL_MS } from "@/constants";
import type { AddTaskOptions, RegisteredTask, TaskFn, TaskRunResult, TaskSummary } from "@/types";

/**
 * 定时任务队列：支持注册多个任务，每个任务以各自独立的间隔周期性执行。
 *
 * 特性：
 * - 每个任务可自定义执行间隔与可选配置（立即执行、最大次数、出错策略、回调）。
 * - 防重叠保护：某次执行尚未结束时，下一次触发会被跳过，避免任务堆叠。
 * - 支持整体 / 单个任务的启动、停止、移除与查询。
 *
 * @example
 * const queue = new TaskQueue();
 * queue.add(async () => console.log("hello"), { intervalMs: 1000, id: "t1" });
 * queue.start();
 */
export class TaskQueue {
  /** 已注册任务：id -> 完整任务定义 */
  private readonly tasks = new Map<string, RegisteredTask>();
  /** 各任务对应的定时器句柄 */
  private readonly timers = new Map<string, ReturnType<typeof setInterval>>();
  /** 各任务已执行次数 */
  private readonly runCounts = new Map<string, number>();
  /** 各任务是否正在执行（防重叠标记） */
  private readonly running = new Map<string, boolean>();
  /** 队列整体是否已启动 */
  private started = false;

  /**
   * 新增一个定时任务。
   * @param fn 要周期执行的任务函数
   * @param options 含 intervalMs（必填）及可选配置
   * @returns 任务 id（用于后续 remove / stop 等操作）
   */
  add(fn: TaskFn, options: AddTaskOptions): string {
    if (typeof fn !== "function") {
      throw new Error("TaskQueue.add 失败：fn 必须是函数。");
    }
    const intervalMs = options.intervalMs;
    if (!Number.isFinite(intervalMs) || intervalMs < TASK_MIN_INTERVAL_MS) {
      throw new Error(
        `TaskQueue.add 失败：intervalMs 必须为不小于 ${TASK_MIN_INTERVAL_MS} 的数字。`,
      );
    }
    const id = options.id ?? this.generateId();
    if (this.tasks.has(id)) {
      throw new Error(`TaskQueue.add 失败：任务 id "${id}" 已存在。`);
    }
    const task: RegisteredTask = {
      id,
      fn,
      intervalMs,
      immediate: options.immediate ?? TASK_DEFAULTS.IMMEDIATE,
      maxRuns: options.maxRuns,
      continueOnError: options.continueOnError ?? TASK_DEFAULTS.CONTINUE_ON_ERROR,
      onRun: options.onRun,
    };
    this.tasks.set(id, task);
    this.runCounts.set(id, 0);
    this.running.set(id, false);
    // 队列已启动时，新任务立即纳入调度
    if (this.started) {
      this.scheduleTask(id);
    }
    return id;
  }

  /**
   * 启动整个队列：为所有尚未调度的任务建立定时器。
   * 之后新增的任务也会自动开始调度。
   */
  start(): void {
    this.started = true;
    for (const id of this.tasks.keys()) {
      this.scheduleTask(id);
    }
  }

  /**
   * 停止整个队列：清除所有任务的定时器，但保留已注册任务定义。
   * 调用 start 可恢复调度。
   */
  stop(): void {
    this.started = false;
    for (const id of [...this.timers.keys()]) {
      this.clearTimer(id);
    }
  }

  /**
   * 仅启动指定任务的调度。
   * @param id 目标任务 id
   */
  startTask(id: string): void {
    if (!this.tasks.has(id)) {
      throw new Error(`TaskQueue.startTask 失败：任务 "${id}" 不存在。`);
    }
    this.started = true;
    this.scheduleTask(id);
  }

  /**
   * 仅停止指定任务的调度（任务定义仍保留，可再次 startTask）。
   * @param id 目标任务 id
   */
  stopTask(id: string): void {
    this.clearTimer(id);
  }

  /**
   * 移除指定任务：停止调度并删除其定义与计数。
   * @param id 目标任务 id
   * @returns 是否存在并成功移除该任务
   */
  remove(id: string): boolean {
    this.clearTimer(id);
    this.runCounts.delete(id);
    this.running.delete(id);
    return this.tasks.delete(id);
  }

  /** 清空全部任务、计数与调度。 */
  clear(): void {
    this.stop();
    this.tasks.clear();
    this.runCounts.clear();
    this.running.clear();
  }

  /**
   * 查询某个任务是否存在。
   * @param id 目标任务 id
   */
  has(id: string): boolean {
    return this.tasks.has(id);
  }

  /**
   * 返回所有任务的摘要信息（id、间隔、执行次数、是否运行中）。
   * @returns 任务摘要数组
   */
  list(): TaskSummary[] {
    return [...this.tasks.values()].map((task) => ({
      id: task.id,
      intervalMs: task.intervalMs,
      runCount: this.runCounts.get(task.id) ?? 0,
      running: this.running.get(task.id) ?? false,
    }));
  }

  /** 为单个任务建立周期性调度（立即执行 + 间隔执行）。 */
  private scheduleTask(id: string): void {
    const task = this.tasks.get(id);
    if (!task || this.timers.has(id)) {
      return;
    }
    if (task.immediate) {
      void this.execute(id);
    }
    const timer = setInterval(() => {
      void this.execute(id);
    }, task.intervalMs);
    this.timers.set(id, timer);
  }

  /** 执行单个任务一次（含防重叠、次数限制与错误处理）。 */
  private async execute(id: string): Promise<void> {
    const task = this.tasks.get(id);
    if (!task) {
      return;
    }
    // 上次尚未结束则跳过本次，避免任务堆叠
    if (this.running.get(id)) {
      return;
    }
    const current = this.runCounts.get(id) ?? 0;
    const maxRuns = task.maxRuns;
    if (typeof maxRuns === "number" && maxRuns > 0 && current >= maxRuns) {
      this.stopTask(id);
      return;
    }

    this.running.set(id, true);
    const start = Date.now();
    let ok = true;
    let error: unknown;
    try {
      await task.fn();
    } catch (e) {
      ok = false;
      error = e;
    } finally {
      const durationMs = Date.now() - start;
      const runIndex = current + 1;
      this.runCounts.set(id, runIndex);
      this.running.set(id, false);

      const result: TaskRunResult = {
        id,
        runIndex,
        ok,
        error,
        durationMs,
        timestamp: start,
      };
      task.onRun?.(result);

      // 出错且配置为不继续时，停止该任务调度
      if (!ok && !task.continueOnError) {
        this.stopTask(id);
      }
    }
  }

  /** 生成唯一任务 id（前缀 + UUID）。 */
  private generateId(): string {
    return `${AUTO_TASK_ID_PREFIX}-${randomUUID()}`;
  }

  /** 清除某任务的定时器并移除句柄。 */
  private clearTimer(id: string): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(id);
    }
  }
}
