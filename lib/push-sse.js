// SSE 传输适配器:把 lib/bus 的事件写成 text/event-stream;每 20 秒注释心跳,防止 Render 代理断开空闲连接
const { subscribe } = require('./bus');
function sse(req, res, filter) {
  res.set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.status(200); res.flushHeaders(); if (req.socket) { req.socket.setTimeout(0); req.socket.setNoDelay(true); }
  res.write(':' + ' '.repeat(2048) + '\n\nretry: 3000\n\nevent: ping\ndata: {}\n\n'); // 首包填充,避免代理缓冲
  const off = subscribe(filter, e => res.write(`event: chat\ndata: ${JSON.stringify(e)}\n\n`));
  const hb = setInterval(() => res.write('event: ping\ndata: {}\n\n'), 20000); // 心跳(客户端据此判断连接是否存活)
  let closed = false; const done = () => { if (closed) return; closed = true; clearInterval(hb); off(); };
  req.on('close', done); res.on('error', done);
}
module.exports = { sse };
