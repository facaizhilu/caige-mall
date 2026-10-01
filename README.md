# 财哥商城 · Caige Mall

一个功能完整的中文电商演示站(前台商城 + 独立管理后台)。
技术栈:**Node.js + Express + SQLite(better-sqlite3)+ EJS 服务端渲染**,纯手写 CSS(红金配色、响应式),无前端构建步骤。

> ⚠️ 演示项目:所有商品/订单/会员数据均为虚构;**支付、短信、物流均为模拟**,不接入任何真实支付/短信/快递渠道。

## 快速开始(一条命令)

```bash
npm install && npm start
```

- 需要 Node.js ≥ 18(在 Node 20 上开发测试)。首次启动会自动创建 SQLite 库(`data/mall.db`)并写入演示数据。
- 前台:<http://localhost:3000/>  后台:<http://localhost:3000/admin>
- 换端口:`PORT=8080 npm start`;重置演示数据:`npm run seed`(会清空数据库!)

## 默认账号

| 端 | 账号 | 密码 | 说明 |
|---|---|---|---|
| 后台 | `admin` | `admin123` | 超级管理员(全部权限) |
| 后台 | `ops` | `ops123456` | 运营专员(仅商品/营销/内容/统计等) |
| 后台 | `kefu` | `kefu123456` | 客服专员(订单/评价/会员/客服) |
| 前台会员 | `13800000001` | `123456` | 黄金会员,有订单/优惠券/余额/积分(另有 13800000002~13500000007,密码均为 123456) |

前台与后台使用**各自独立的 Cookie 会话**(`cg.sid` / `cg_admin.sid`,后台 Cookie 限定 `/admin` 路径),互不通用。**上线前务必修改默认密码与 `SESSION_SECRET`。**
短信验证码登录为模拟:验证码直接显示在页面上。

## 已实现功能

**前台 `/`**
- 首页:Logo/搜索/热搜词、Banner 轮播、分类导航、秒杀、拼团、热卖/新品、领券、品牌、公告
- 商品列表:分类(二级)/品牌/价格区间筛选、搜索、排序(综合/销量/新品/价格)、分页;商品详情:多图、**SKU 规格联动**、库存、评价(筛选/晒图)、收藏、加购/立即购买
- 购物车(勾选/改数量/库存校验)→ 结算(**省/市/区地址**选择或新增、优惠券、积分抵现、运费模板实时计算、会员折扣)→ **模拟收银台**(微信/支付宝/余额)
- 订单:待付款/待发货/待收货/已完成/已取消/已退款;超时自动取消、确认收货、再次购买、**物流轨迹**、**发票申请**、**评价(含图片上传)**、**退款/退货退款售后**
- 会员中心:手机号+密码注册/登录、**短信验证码登录(模拟)**、资料/改密、**多地址管理**、收藏、**浏览记录**、优惠券(含**领券中心**)、**积分与每日签到**、**余额与充值(模拟)**、**会员等级/成长值**、**邀请好友/分销**(佣金转余额)
- 营销:**限时秒杀**(倒计时/限购/库存)、**拼团**(发起/参团/成团/超时自动退款)、**积分商城**(兑换实物/优惠券)
- 内容:商城公告、**帮助中心**(搜索)、文章页、**客服页**(关键词自动回复 + 人工回复)

**后台 `/admin`(独立布局与登录)**
- 数据概览(今日/累计销售、订单、会员、待办提醒、趋势图、热销榜、库存预警)、**统计报表**(销售/会员趋势、分类占比、支付方式、商品/会员排行,服务端 SVG 图表,7/30/90 天)
- 商品(CRUD、上下架、图片上传、**多 SKU**、库存调整)、分类(两级)、**品牌**、**运费模板**、**库存预警**
- 订单(筛选/搜索/详情/**发货**填写快递公司与运单号/取消并退款/改收货信息/备注/物流节点)、**售后审核**(同意退款、同意退货→确认收货退款、拒绝)、**发票开具/驳回**、**评价审核**(通过/拒绝/回复/删除,通过奖励积分)
- 会员(列表/搜索/筛选/详情、启用禁用、**调整积分/余额**、设置等级、发券、重置密码、备注)、**会员等级**管理、**分销管理**
- 营销:优惠券、秒杀、拼团(+团列表)、积分商城商品、Banner、热搜词;内容:公告/帮助文章/单页;**客服中心**
- 系统:**站点设置**(商城名称/客服信息/积分比例/佣金/库存阈值/超时规则等)、**管理员账号**、**角色权限 RBAC**(10 个模块权限,菜单与接口双重校验)、**操作日志**
- **CSV 导出**:订单、会员、商品库存、操作日志

## 安全说明(演示级)
- 密码:bcrypt 哈希;登录失败限流(10 分钟 8 次);登录后重新生成 session
- CSRF:所有 POST 校验会话级 token(表单隐藏域 / `X-CSRF-Token`),Cookie `HttpOnly + SameSite=Lax`
- 上传:仅登录用户/管理员可上传,限制图片类型(扩展名+MIME)与大小(3MB);模板默认 HTML 转义;CSV 导出防公式注入
- 业务:下单在事务中校验并扣减库存(超卖保护);订单取消/退款会回滚库存、优惠券、积分、秒杀库存
- 未做:HTTPS/反向代理配置、验证码防刷、真实短信/支付、密码找回(演示环境)、图片压缩

## 目录结构
```
server.js            入口(双会话、CSRF、占位图、上传)
lib/                 db.js(建表) seed.js(演示数据) svc.js(下单/支付/退款/拼团等业务) crud.js chart.js regions.js util.js
routes/shop.js       前台路由        routes/admin.js   后台路由
views/shop|admin     EJS 模板         public/css|js     样式与脚本
test/smoke.js        冒烟测试(119 项)  test/flows.js     进阶流程测试(27 项)
scripts/screenshots.js  截图脚本(playwright-core + 系统 Chrome)
```

## 测试
```bash
npm start &                  # 先在全新数据库上启动
npm test                     # 冒烟测试:注册→登录→加购→下单→支付→后台发货→收货→评价审核→售后退款→后台商品/会员管理 等
node test/flows.js           # 拼团成团/失败、秒杀、券+积分抵扣、运费、退货退款、上传
```
(测试会写入数据库,可用 `npm run seed` 重置。)

## 说明与已知限制
- 省市区为精简示例数据(`lib/regions.js`),非全国完整行政区划;图片为本地生成的 SVG 占位图
- 物流轨迹为模拟(后台/前台可「模拟推进」),不对接快递 API
- 拼团仅支持活动指定的默认规格;秒杀/拼团订单需单独结算,不可使用优惠券/积分/会员折扣
- 无多语言、无多商户、无库存锁定超时(下单即扣库存,超时取消回补)

## 部署到 Linux 服务器(Node + pm2 + Nginx + HTTPS)

以 Ubuntu/Debian 为例,域名假设为 `mall.example.com`(已解析到服务器 IP)。

**1. 安装 Node 与 Nginx**(better-sqlite3 有预编译包,通常无需编译;若 `npm install` 报编译错误则 `apt install -y build-essential python3`)
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash - && sudo apt install -y nodejs nginx
sudo npm i -g pm2
```

**2. 部署代码并配置环境变量**
```bash
sudo mkdir -p /srv/caige-mall /var/lib/caige-mall && sudo chown $USER /srv/caige-mall /var/lib/caige-mall
git clone <你的仓库> /srv/caige-mall   # 或 rsync/scp 上传(不要上传 node_modules、data)
cd /srv/caige-mall && npm install --omit=dev
```
| 环境变量 | 说明 |
|---|---|
| `PORT` | 监听端口,默认 3000(Nginx 反代到此端口,防火墙不要对外开放该端口) |
| `SESSION_SECRET` | **必须设置**为随机长字符串:`openssl rand -hex 32`;需保持固定,否则重启后所有登录会话失效 |
| `DATA_DIR` | SQLite 数据目录,默认 `./data`;建议放到持久化路径如 `/var/lib/caige-mall` 并定期备份 |

**3. 修改默认管理员密码**:首次启动后立刻用 `admin / admin123` 登录后台,点右上角账号名「修改密码」(≥8 位);并在「管理员账号」中停用或改密 `ops`、`kefu` 演示账号。演示会员(13800000001 等,密码 123456)和演示商品订单仅供体验,正式上线请在后台禁用/清理,或自行准备一份只含管理员与基础设置的空库。

**4. 用 pm2 守护进程**
```bash
cd /srv/caige-mall
PORT=3000 SESSION_SECRET=$(openssl rand -hex 32) DATA_DIR=/var/lib/caige-mall \
  pm2 start server.js --name caige-mall --update-env
pm2 save && pm2 startup     # 按提示执行输出的命令,实现开机自启
pm2 logs caige-mall         # 查看日志
```
(推荐把环境变量写入 `ecosystem.config.js` 的 `env` 字段,避免每次手敲。)

**5. Nginx 反向代理** — `/etc/nginx/sites-available/caige-mall`:
```nginx
server {
    listen 80;
    server_name mall.example.com;
    client_max_body_size 10m;            # 评价/商品图片上传
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
```bash
sudo ln -s /etc/nginx/sites-available/caige-mall /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx
```

**6. HTTPS(Let's Encrypt)**
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d mall.example.com      # 自动改写 Nginx 配置并配置续期
```
站点已设置 `trust proxy`,经 Nginx 的 `X-Forwarded-*` 头可正确识别客户端 IP。上 HTTPS 后建议在 `server.js` 的 `cookieBase` 中加上 `secure: true`。

**7. 防火墙与运维**:只开放 80/443(`ufw allow 'Nginx Full'`);定期备份 `DATA_DIR/mall.db`(SQLite 为 WAL 模式,备份用 `sqlite3 mall.db ".backup backup.db"`)和 `public/uploads/`;更新代码后 `npm install --omit=dev && pm2 restart caige-mall`。
