// stop typescript from complaining about Convex in this file
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const Convex: {
  syscall: (op: string, jsonArgs: string) => string;
  asyncSyscall: (op: string, jsonArgs: string) => Promise<string>;
  jsSyscall: (op: string, args: Record<string, any>) => any;
  op: (opName: string, ...args: any[]) => any;
};

export function performOp(op: string, ...args: any[]): any {
  if (typeof Convex === "undefined" || Convex.op === undefined) {
    throw new Error(
      "The Convex execution environment is being unexpectedly run outside of a Convex backend."
    );
  }
  return Convex.op(op, ...args);
}

(globalThis as any).crypto.getRandomValues = (typedArray: ArrayBufferView) => {
  const randomValues = performOp(
    "crypto/getRandomValues",
    // TODO: Fix this upstream.
    typedArray.byteLength
  );
  if (typedArray instanceof Uint8Array) {
    typedArray.set(randomValues);
    return typedArray;
  }
  const ui8 = new Uint8Array(
    typedArray.buffer,
    typedArray.byteOffset,
    typedArray.byteLength
  );
  ui8.set(randomValues);
  return typedArray;
};
