// src/utils/iframeRpc.ts
export type RpcRequest = { type: string; requestId: number; payload?: any };
export type RpcResponse = { type: string; requestId: number; payload?: any; error?: string };

export function createIframeRPC(getWin: () => Window | null) {
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();

  function onMessage(event: MessageEvent) {
    const data = event.data as RpcResponse | undefined;
    if (!data || typeof data !== "object") return;
    if (!("requestId" in data)) return;

    const entry = pending.get(data.requestId);
    if (!entry) return;
    pending.delete(data.requestId);

    if (data.error) entry.reject(new Error(data.error));
    else entry.resolve(data.payload);
  }

  window.addEventListener("message", onMessage);

  return {
    request<T = any>(type: string, payload?: any): Promise<T> {
      const win = getWin();
      if (!win) return Promise.reject(new Error("iframe window not ready"));
      const requestId = nextId++;
      const msg: RpcRequest = { type, requestId, payload };
      win.postMessage(msg, "*");
      return new Promise<T>((resolve, reject) => pending.set(requestId, { resolve, reject }));
    },
    dispose() {
      window.removeEventListener("message", onMessage);
      pending.clear();
    },
  };
}