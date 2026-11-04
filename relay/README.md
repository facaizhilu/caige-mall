# 京东 VOP(来一票)接口中转 relay

来一票只允许白名单 IP 调用。演示站(Render)不在白名单内,所以由白名单服务器上的本中转服务代为调用:

```
演示站 (JDVOP_RELAY_URL + JDVOP_RELAY_TOKEN) ──HMAC 签名──▶ 中转 :8080 ──AES 签名 + 凭证──▶ 来一票 API
```

## 安全设计
- **凭证不出服务器**:AppKey / AppSecret / 租户号只在服务器 `/etc/yunnong/jdvop.env`(root:jdvop-relay 640),由中转签名;演示站只持有中转令牌。
- **请求认证**:`X-Relay-Ts`(13 位毫秒)、`X-Relay-Nonce`、`X-Relay-Sig = HMAC-SHA256(令牌, METHOD\nPATH\nTS\nNONCE\nSHA256(body))`;时间窗 ±60 秒,随机串防重放,常量时间比较。令牌本身从不在网络上传输。
- **接口白名单**:只放行商城用到的查询类接口;下单/取消/售后类(`submitOrder` `confirmOrder` `cancelOrder` `updateSendInfo` `createAfs` `cancelAfs` `confirmAfs`)**默认禁止**,需 `RELAY_ALLOW_ORDERS=1`。
- **限流**:全局串行,间隔 ≥1.1 秒(上游 QPS=1);排队上限 40;单 IP 每分钟 90 次;10 分钟内认证失败 20 次的 IP 封禁 1 小时;请求体上限 64KB。
- **日志**(journald):只记录时间、IP、路径、接口名、上游返回码、耗时;不记录请求体、凭证、签名、令牌。
- systemd 以无登录 shell 的系统用户 `jdvop-relay` 运行,并启用 `ProtectSystem=strict` 等隔离选项。
- 注意:目前为 HTTP(IP 直连,无域名证书)。HMAC 保证请求不可伪造/重放,但内容(商品查询参数与返回的商品数据)为明文;以后开放下单(含收货地址)前应加域名 + HTTPS。

## 接口
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 健康检查(无需认证,只返回 `{"ok":true}`) |
| POST | `/v1/call` | body `{"interfaceCode":"searchGoodsList","data":{...}}`,原样返回上游 JSON |
| GET | `/v1/balance` | 预存款余额(上游 customerBalance) |

## 环境变量(`/etc/yunnong/relay.env`)
| 变量 | 说明 |
|---|---|
| `RELAY_TOKEN` | 共享令牌(≥32 字符,`openssl rand -hex 32`);演示站的 `JDVOP_RELAY_TOKEN` 与之相同 |
| `RELAY_PORT` / `RELAY_HOST` | 默认 8080 / 0.0.0.0 |
| `RELAY_ALLOW_ORDERS` | `1` 才放行下单/售后类接口,默认关闭 |
| `RELAY_ALLOW_IPS` | 可选,逗号分隔的来源 IP 白名单 |
| `RELAY_MIN_INTERVAL_MS` / `RELAY_QUEUE_MAX` / `RELAY_PER_IP_PER_MIN` | 限流参数 |

## 部署(服务器 114.55.142.121)
- 代码:`/opt/jdvop-relay/`(只需 `relay/jdvop-relay.js` 与 `lib/suppliers/jdvop/{config,sign,relay-auth}.js`,无 npm 依赖)
- 服务:`systemctl status jdvop-relay`,日志 `journalctl -u jdvop-relay -f`
- 防火墙:`ufw allow 8080/tcp`,并在阿里云控制台放行 8080
- 更换令牌:`openssl rand -hex 32 > /root/relay-token.txt`,改 `/etc/yunnong/relay.env` 后 `systemctl restart jdvop-relay`,再改演示站的 `JDVOP_RELAY_TOKEN`

## 演示站(Render)需要设置
`JDVOP_MODE=live`、`JDVOP_RELAY_URL=http://114.55.142.121:8080`、`JDVOP_RELAY_TOKEN=<令牌>`。不需要也不应设置 AppKey/AppSecret/租户号。
演示站(`DEMO_MODE=1`)无论如何都不会向供应商真实下单。
