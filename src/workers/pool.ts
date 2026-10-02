import type { WorkerRequest, WorkerResponse } from './protocol'

type Pending = {
  resolve: (value: WorkerResponse) => void
  reject: (err: Error) => void
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
export type TaskRequest = DistributiveOmit<WorkerRequest, 'id'>

/**
 * 渲染 worker 池 —— 主线程与 OffscreenCanvas 渲染的桥梁。
 * 池大小 min(4, cores-1)；任务经 postMessage 结构化克隆分发（File 为引用传递，零拷贝）。
 */
export class TaskCancelled extends Error {
  constructor() {
    super('cancelled')
    this.name = 'TaskCancelled'
  }
}

export class RenderPool {
  private readonly workers: Worker[] = []
  private readonly idle: Worker[] = []
  private readonly queue: Array<{
    request: WorkerRequest
    pending: Pending
  }> = []
  private readonly pending = new Map<string, Pending>()
  private nextId = 0

  constructor(size = Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 4) - 1))) {
    for (let i = 0; i < size; i += 1) {
      this.workers.push(this.spawn())
    }
  }

  private spawn(): Worker {
    const worker = new Worker(new URL('./render.worker.ts', import.meta.url), {
      type: 'module',
      name: 'picseal-render'
    })
    worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      const response = event.data
      const pending = this.pending.get(response.id)
      this.pending.delete(response.id)
      this.idle.push(worker)
      if (pending) {
        if (response.ok) pending.resolve(response)
        else pending.reject(new Error(response.error))
      }
      this.drain()
    })
    worker.addEventListener('error', (event) => {
      // worker 崩溃：拒绝其全部在途任务并重建
      for (const [id, pending] of this.pending) {
        pending.reject(new Error(event.message || 'worker crashed'))
        this.pending.delete(id)
      }
      const index = this.workers.indexOf(worker)
      if (index >= 0) {
        void index
        this.workers.splice(index, 1)
        const fresh = this.spawn()
        this.workers.push(fresh)
        this.idle.push(fresh)
      }
      this.drain()
    })
    this.idle.push(worker)
    return worker
  }

  run(request: TaskRequest): Promise<WorkerResponse> {
    const id = `t${(this.nextId += 1)}`
    const full = { ...request, id } as WorkerRequest
    return new Promise<WorkerResponse>((resolve, reject) => {
      this.queue.push({ request: full, pending: { resolve, reject } })
      this.drain()
    })
  }

  /** 撤销尚未分发到 worker 的排队任务（批量取消/暂停用） */
  cancelQueued(filter: (request: WorkerRequest) => boolean): number {
    let cancelled = 0
    const remaining: typeof this.queue = []
    for (const task of this.queue) {
      if (filter(task.request)) {
        cancelled += 1
        task.pending.reject(new TaskCancelled())
      } else {
        remaining.push(task)
      }
    }
    this.queue.length = 0
    this.queue.push(...remaining)
    return cancelled
  }

  private drain(): void {
    while (this.queue.length > 0 && this.idle.length > 0) {
      const task = this.queue.shift()!
      const worker = this.idle.shift()!
      this.pending.set(task.request.id, task.pending)
      worker.postMessage(task.request)
    }
  }

  get size(): number {
    return this.workers.length
  }

  get busy(): number {
    return this.pending.size
  }

  get queued(): number {
    return this.queue.length
  }

  terminate(): void {
    for (const worker of this.workers) worker.terminate()
    this.workers.length = 0
    this.idle.length = 0
  }
}

let shared: RenderPool | null = null

/** 应用级共享池（预览与批量导出共用，FIFO 保证预览请求不被大批量饿死太久） */
export function getRenderPool(): RenderPool {
  if (!shared) shared = new RenderPool()
  return shared
}
