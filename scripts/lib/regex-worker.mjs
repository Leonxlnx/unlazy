import { parentPort } from "node:worker_threads";

parentPort.once("message", ({ source, flags, output }) => {
  try {
    parentPort.postMessage({ matched: new RegExp(source, flags).test(output) });
  } catch (error) {
    parentPort.postMessage({ error: error.message });
  }
});
