// 全局限流:所有接口共用一个队列,两次调用开始时间至少间隔 minIntervalMs(文档 QPS=1;QPM=100 在 QPS=1 下不会触及)
let last = 0, chain = Promise.resolve();
function schedule(fn, minIntervalMs) {
  const run = chain.then(async () => {
    const wait = last + minIntervalMs - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    last = Date.now();
  });
  chain = run.catch(() => {});
  return run.then(fn);
}
function pending() { return chain; }
module.exports = { schedule, pending };
