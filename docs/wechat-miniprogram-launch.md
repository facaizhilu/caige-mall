# 财哥商城 · 微信小程序正式上线实操手册

> 目标：将现有 Node.js Express + SQLite 电商站「财哥商城」([github.com/facaizhilu/caige-mall](https://github.com/facaizhilu/caige-mall)，当前 Render 演示站) 改造为**境内正式上线**的微信小程序 + 微信支付。  
> 前提：企业主体营业执照与合规资料已备齐；用户将自行采购**中国大陆云服务器 + 域名并完成 ICP 备案**；运营者在老挝，客户在中国大陆。  
> 文档日期：2026-10-05。以下链接以微信开放文档 / 微信支付商户文档为准，上线前请再核对一次。

---

## 目录

1. [账号与合规清单](#1-账号与合规清单)
2. [微信支付商户开通与绑定](#2-微信支付商户开通与绑定)
3. [架构改造建议](#3-架构改造建议)
4. [必做 API 清单（对照现有代码）](#4-必做-api-清单对照现有代码)
5. [域名与安全](#5-域名与安全)
6. [开发/体验版 vs 正式版差异](#6-开发体验版-vs-正式版差异)
7. [提审常见驳回原因](#7-提审常见驳回原因)
8. [分阶段实施计划](#8-分阶段实施计划)
9. [香港/境外服务器做不到的事](#9-香港境外服务器做不到的事)
10. [官方文档索引](#10-官方文档索引)

---

## 1. 账号与合规清单

### 1.1 企业主体小程序注册

| 步骤 | 说明 | 官方入口 |
|------|------|----------|
| 注册小程序 | 用企业主体在 [mp.weixin.qq.com](https://mp.weixin.qq.com) 注册；主体选「企业」或「企业（个体工商户）」 | [小程序介绍/主体说明](https://developers.weixin.qq.com/miniprogram/introduction/) |
| 主体验证 | 企业对公打款 **或** 微信认证（认证费约 300 元/年）；**已认证账号才可使用微信支付权限** | 同上 |
| 管理员 | 绑定境内实名微信；法人/管理员身份证清晰可用 | — |
| 基本信息 | 名称、简介、头像、服务范围须与真实经营一致，禁绝对化用语（「最」「国家级」等） | [常见拒绝情形](https://developers.weixin.qq.com/miniprogram/product/reject) |

### 1.2 服务类目与商品资质

- 电商商城通常选：**商家自营 / 电商平台** 等非个人开放类目（以提交时后台可选列表为准）。
- 类目须与实际售卖一致；食品、进口、化妆品、医疗器械等有**专项许可证**要求。
- 资质材料：扫描件或复印件加盖公司红章，法人身份证复印件签字；须在有效期内。
- 参考：
  - [小程序开放的服务类目](https://developers.weixin.qq.com/miniprogram/product/material)
  - [非个人主体开放类目资质标准](https://developers.weixin.qq.com/miniprogram/product/mini-store/leimuzizhi/qiyeleimu.html)
  - [交易类小程序运营规范](https://developers.weixin.qq.com/miniprogram/product/jiaoyilei/yunyingguifan.html)

**财哥商城注意**：当前演示商品多为虚构；正式提审前必须换成真实可售商品，并按类目上传资质，禁售品参见平台禁发列表。

### 1.3 ICP 备案（域名 + 小程序）

| 项 | 要求 |
|----|------|
| 服务器域名 ICP | 配置为小程序「request 合法域名」的域名**必须已完成 ICP 备案**；新备案域名通常需满约 24 小时后才可配置 | 
| 小程序备案 | 2023 年起小程序本身也需备案；在公众平台按指引提交主办单位/负责人证件等 | 
| 接入商 | 备案须在**实际接入的大陆云厂商**办理（阿里云/腾讯云/华为云等） |

官方：

- [小程序备案操作指引](https://developers.weixin.qq.com/miniprogram/product/record/guidelines)
- [小程序备案常见问答](https://developers.weixin.qq.com/miniprogram/product/record/record_faq.html)
- [网络 · 域名须 ICP 备案](https://developers.weixin.qq.com/miniprogram/dev/framework/ability/network.html)

用户已声明自行买大陆云 + 域名并办 ICP —— **这是硬前置，没有备案就无法配置合法域名，小程序真机无法访问后端。**

### 1.4 服务器域名白名单与 HTTPS

在「小程序后台 → 开发 → 开发管理 → 开发设置 → 服务器域名」配置：

| 类型 | 用途 | 协议 |
|------|------|------|
| request 合法域名 | `wx.request` API | `https://` |
| uploadFile 合法域名 | 图片上传等 | `https://` |
| downloadFile 合法域名 | 图片/文件下载 | `https://` |
| socket 合法域名（可选） | WebSocket | `wss://` |
| 业务域名（可选） | `web-view` 打开 H5 | `https://` + 校验文件 |

要点（官方强制）：

- 不能用 IP、localhost；不支持父域名通配；`api.weixin.qq.com` 不可配为业务服务器域名。
- HTTPS 证书有效、域名匹配、信任链完整；**TLS ≥ 1.2**；iOS 不支持自签名。
- AppSecret 只放后端，前端禁止直调微信开放接口。

详见 [网络文档](https://developers.weixin.qq.com/miniprogram/dev/framework/ability/network.html)、[域名管理](https://developers.weixin.qq.com/doc/oplatform/developers/basic_func/domain.html)。

### 1.5 用户隐私保护指引与协议页

- 在公众平台配置「用户隐私保护指引」（收集手机号、地址、位置、相册等须声明用途）。
- 小程序内提供可访问的《用户协议》《隐私政策》页面（可链到自有 HTTPS 页面或小程序内页）。
- 获取手机号须用户主动点击授权组件，不得静默采集。

官方：

- [用户隐私保护指引填写说明](https://developers.weixin.qq.com/miniprogram/dev/framework/user-privacy/)
- [小程序用户隐私保护指引内容介绍](https://developers.weixin.qq.com/miniprogram/dev/framework/user-privacy/miniprogram-intro.html)

### 1.6 合规 checklist（上线前打勾）

- [ ] 企业小程序已注册并完成微信认证  
- [ ] 服务类目与商品资质已上传并通过  
- [ ] 大陆服务器上线，域名已 ICP 备案，小程序备案已提交/通过  
- [ ] request / uploadFile / downloadFile 合法域名已配置且证书 TLS1.2+  
- [ ] 隐私保护指引已配置；协议页可打开  
- [ ] 微信支付商户号已开通并与小程序 AppID 绑定  
- [ ] 实物电商已接入「订单发货信息管理」  
- [ ] 提审测试账号可走通：登录→浏览→加购→下单→支付→看订单  

---

## 2. 微信支付商户开通与绑定

### 2.1 申请条件

- 小程序须**已完成微信认证**（企业主体）。
- 境内商户：营业执照、法人身份证、**对公银行账户**（个体户可用法人对私账户，以进件页为准）。
- 申请本身免费；费率约 0.6%–1%（按类目）。

官方入口：

- [小程序接入支付指引（商户平台）](https://pay.weixin.qq.com/static/applyment_guide/applyment_detail_miniapp.shtml)
- [小程序绑定微信支付](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/bind/bind-wxpay.html)
- [小程序支付管理服务介绍](https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/ministore/wxafunds/Introduction.html)

### 2.2 推荐路径（二选一）

**路径 A（推荐给新商户）**：小程序后台「支付与交易 / 支付管理」内申请专用商户号 → **申请成功后自动绑定当前小程序**，无需再到商户平台单独绑 AppID。

**路径 B（已有商户号）**：

1. 登录 [pay.weixin.qq.com](https://pay.weixin.qq.com) → 产品中心 → APPID 授权管理 → 关联小程序 AppID。  
2. 小程序管理员在公众平台「微信支付 - 商户号管理」确认授权。  
3. 主体不一致需补充材料与联合运营承诺函，审核约 1–3 个工作日。  

参考：[管理商户号绑定的 APPID](https://pay.weixin.qq.com/doc/v3/merchant/4013287504)。

### 2.3 技术侧必备材料（后端）

| 项 | 用途 |
|----|------|
| 商户号 mchid | 下单、查单 |
| APIv3 密钥 | 回调解密、签名相关 |
| 商户 API 证书（私钥 + 序列号） | APIv3 请求签名 |
| 微信支付平台证书 / 公钥 | 验签回调 |
| 小程序 AppID + AppSecret | code2session、发货信息等 |

建议使用官方 Node SDK 或成熟库处理签名与验签，勿手写加密细节。

### 2.4 支付技术流程（小程序）

```
用户下单 → 后端创建本站订单(unpaid)
         → 后端 POST /v3/pay/transactions/jsapi（payer.openid、out_trade_no、amount、notify_url）
         → 得 prepay_id
         → 后端按规则生成 timeStamp/nonceStr/package/paySign
         → 小程序 wx.requestPayment(...)
         → 微信异步 POST notify_url（加密 resource）
         → 后端验签 + 解密 + 幂等改订单为已支付
         → （可选）查询订单二次确认
```

官方：

- [JSAPI/小程序下单](https://pay.weixin.qq.com/doc/v3/merchant/4012791856)
- [支付成功回调通知](https://pay.weixin.qq.com/doc/v3/merchant/4012791861)
- [wx.requestPayment](https://developers.weixin.qq.com/miniprogram/dev/api/payment/wx.requestPayment.html)
- [小程序调起支付（商户文档）](https://pay.weixin.qq.com/doc/v3/merchant/4012791898)

### 2.5 实物电商强制：订单发货管理

提供实物在线销售配送的小程序须接入平台「订单发货信息管理」：支付后按约定时效发货（普通商品通常 **48 小时内**），并上传真实物流单号；虚假发货/超时会触发支付风险直至暂停交易。

- [交易类运营规范](https://developers.weixin.qq.com/miniprogram/product/jiaoyilei/yunyingguifan.html)
- [订单发货管理功能介绍](https://developers.weixin.qq.com/miniprogram/product/jiaoyilei/fahuoguanligongneng.html)
- [发货信息录入 API](https://developers.weixin.qq.com/miniprogram/dev/server/API/order_shipping/api_uploadshippinginfo.html)

后台「发货」逻辑（现有 `svc.shipOrder`）上线时需**额外调用**微信发货信息录入接口。

---

## 3. 架构改造建议

### 3.1 总体原则

```
┌─────────────────────┐     HTTPS JSON      ┌──────────────────────────────┐
│ 微信小程序前端       │ ◄──────────────────► │ Express 后端（现有）          │
│ （新仓库或 monorepo） │   /api/mp/*         │ + /api/mp 路由                │
│ WXML/WXSS/JS 或     │                     │ + WeChat/Pay SDK              │
│ uni-app 编译产物     │                     │ + SQLite / 后续可迁 MySQL      │
└─────────────────────┘                     │ 保留 /admin EJS 后台          │
                                            │ （可选保留 H5 前台）           │
                                            └──────────────────────────────┘
                         ▲
                         │ 仅服务器访问
              api.weixin.qq.com / api.mch.weixin.qq.com
```

- **保留**现有 Express + `lib/svc.js` 业务（下单、库存事务、优惠券、售后等）。
- **新增** `/api/mp/*` 纯 JSON API（小程序无 Cookie 表单 CSRF；改用登录态 token / 自定义 header）。
- **新建**小程序前端工程；**不要**把现有 EJS 页面塞进 web-view 当主商城（审核与体验差，且依赖业务域名）。
- Render 演示站仅作参考；**生产 API 必须落在已备案大陆域名**。

### 3.2 前端选型：**推荐原生微信小程序**

| 方案 | 优点 | 缺点 | 对本项目 |
|------|------|------|----------|
| **原生微信小程序**（推荐） | 官方能力最全（支付、手机号、发货组件、审核问题最少）；包体可控；文档直接对应 | 仅微信一端；需学 WXML | **首选**：客户全在大陆微信，无 App/多端刚需 |
| uni-app | 一套代码可编译 H5/App；Vue 生态 | 偶发条件编译坑；部分微信新 API 滞后；提审需确认产物合规 | 若明确要同步 H5 商城再考虑 |
| Taro 等 | React 技术栈友好 | 同上，多一层抽象 | 团队已是 React 才值得 |

**推荐理由（财哥商城）**：

1. 现有前台是 EJS SSR，**没有可复用的 Vue/React 组件**，上 uni-app 并无存量资产优势。  
2. 单端微信 + 微信支付 + 发货管理，原生对接路径最短、驳回风险更低。  
3. 后端已是完整电商逻辑，小程序只需薄客户端；管理后台继续用现有 `/admin`。  

### 3.3 会话与安全改造要点

| 现网（H5） | 小程序 |
|------------|--------|
| Cookie `cg.sid` + CSRF 隐藏域 | `wx.login` → 后端发 `token`（存 SQLite sessions 或新表）；请求头 `Authorization: Bearer …` |
| 手机号+密码 / 模拟短信 | openid 登录 + `getPhoneNumber` 绑定手机号（可与现有 `users.phone` 合并） |
| 模拟支付 `payOrder` | 真实统一下单 + 回调；**保留**余额支付需重新评估合规（建议首期仅微信支付） |
| 同源上传 multer | `wx.uploadFile` 到 uploadFile 合法域名；鉴权用 token |

---

## 4. 必做 API 清单（对照现有代码）

> 代码基线：`/workspace/caige-mall`（`routes/shop.js`、`lib/svc.js`、`lib/db.js`）。  
> 现有能力多为 **EJS 页面路由**；小程序需要等价 **JSON**。标注：  
> ✅ 业务已有，需包一层 `/api/mp`　｜　⚠️ 需大改　｜　❌ 全新

### 4.1 登录与用户

| 能力 | 建议路径 | 现状 | 说明 |
|------|----------|------|------|
| code2session 登录 | `POST /api/mp/auth/login` | ❌ | 后端调 [code2Session](https://developers.weixin.qq.com/miniprogram/dev/server/API/user-login/api_code2session)；存 openid，发 token。users 表需加 `openid`/`unionid` |
| 会话校验 | 中间件 | ⚠️ | 现有 `needLogin` 基于 session.uid；改为 token |
| 手机号 | `POST /api/mp/auth/phone` | ❌ | [getPhoneNumber](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/getPhoneNumber.html) + 服务端 [phonenumber.getPhoneNumber](https://developers.weixin.qq.com/miniprogram/dev/server/API/user-info/phone-number/api_getphonenumber) |
| 资料/改密 | `/api/mp/me/*` | ✅ | 对应 `/me/profile`、`/me/password` |
| 退出 | `POST /api/mp/auth/logout` | ✅ | 作废 token |

### 4.2 商品与内容

| 能力 | 建议路径 | 现状 |
|------|----------|------|
| 首页聚合（banner/分类/热卖） | `GET /api/mp/home` | ✅ 逻辑散落 `/` |
| 商品列表/搜索/筛选 | `GET /api/mp/products` | ✅ `/products` |
| 商品详情+SKU | `GET /api/mp/products/:id` | ✅ `/product/:id` |
| 分类/品牌 | `GET /api/mp/categories` 等 | ✅ |
| 公告/帮助/文章 | `GET /api/mp/articles/*` | ✅ |

### 4.3 购物车 / 结算 / 订单

| 能力 | 建议路径 | 现状 |
|------|----------|------|
| 购物车 CRUD | `/api/mp/cart/*` | ✅ `/cart*` |
| 运费/优惠试算 | `POST /api/mp/quote` | ✅ 已有 `/api/quote` JSON |
| 创建订单 | `POST /api/mp/orders` | ✅ `createOrder` |
| 订单列表/详情 | `GET /api/mp/orders` | ✅ |
| 取消/确认收货/再买 | `POST ...` | ✅ |
| 物流轨迹 | `GET .../logistics` | ✅（模拟轨迹可保留，正式应对接快递） |

### 4.4 支付（核心新建）

| 能力 | 建议路径 | 现状 |
|------|----------|------|
| 统一下单 + 返回支付参数 | `POST /api/mp/orders/:id/pay` | ⚠️ 现为模拟收银台 |
| 支付结果回调 | `POST /api/mp/pay/notify`（**勿鉴权用户 token**，验微信签名） | ❌ |
| 主动查单 | 内部/管理 | ❌ |
| 退款（售后同意） | 服务端调微信退款 API | ⚠️ `refundOrder` 仅改库 |

### 4.5 地址 / 优惠券 / 售后 / 营销

| 能力 | 建议路径 | 现状 |
|------|----------|------|
| 地址 CRUD | `/api/mp/addresses` | ✅ |
| 领券/我的券 | `/api/mp/coupons` | ✅ |
| 收藏/浏览 | `/api/mp/favorites` 等 | ✅ |
| 申请售后/填写退货单 | `/api/mp/aftersales` | ✅ |
| 评价+图片 | `/api/mp/reviews` + upload | ✅ |
| 秒杀/拼团/积分商城 | 可选二期 | ✅ 业务有，小程序可后做 |
| 分销/余额充值 | 建议二期或合规评估后 | ✅ 演示有；正式需谨慎 |

### 4.6 微信侧后台任务（无小程序页面，但必做）

| 能力 | 现状 |
|------|------|
| access_token 缓存 | ❌ |
| 发货信息 `upload_shipping_info`（后台点发货时） | ❌ |
| （可选）订阅消息：发货/退款通知 | ❌ |

### 4.7 工作量直觉

- **可复用**：约 70% 电商业务在 `lib/svc.js`（quote/createOrder/cancel/refund/pay 模拟等）。  
- **必须新写**：鉴权、openid 用户模型、`/api/mp` 路由层、微信支付、发货同步、整个小程序 UI。  
- **建议弱化首期**：拼团、秒杀、积分商城、分销、余额充值、模拟短信 —— 减少审核与合规面。

---

## 5. 域名与安全

### 5.1 配置清单（示例）

假设生产域名为 `mall.example.com`（已 ICP）：

| 配置项 | 示例值 |
|--------|--------|
| request | `https://mall.example.com` |
| uploadFile | `https://mall.example.com` |
| downloadFile | `https://mall.example.com`（若图片同域） |
| 业务域名 | 仅当使用 web-view 时配置，并放置校验文件 |
| notify_url | `https://mall.example.com/api/mp/pay/notify` |

注意：配置端口后请求 URL 必须带相同端口；不配端口则 URL **也不能**写 `:443`。

### 5.2 TLS / 证书

- 使用受信任 CA（Let's Encrypt 在大陆云上可用，或云厂商证书）。  
- 开启 TLS1.2+；用 `openssl s_client -connect mall.example.com:443` 自检。  
- Nginx 反代时正确传 `X-Forwarded-Proto`（现有 `trust proxy` 已支持）。

### 5.3 密钥与安全

- AppSecret、APIv3 密钥、商户私钥 **仅服务器环境变量**，禁止进小程序包、禁止进 git。  
- 支付回调必须验签 + 解密 + **幂等**（微信会重试）。  
- 小程序包内不要写死管理接口；后台继续走独立 `/admin` 并限制来源 IP（可选）。

### 5.4 开发期跳过校验

微信开发者工具可勾选「不校验合法域名、TLS 版本及 HTTPS 证书」——**仅开发工具/调试模式**；体验版与正式版必须配置正确域名。见 [网络文档 · 跳过域名校验](https://developers.weixin.qq.com/miniprogram/dev/framework/ability/network.html)。

---

## 6. 开发/体验版 vs 正式版差异

| 维度 | 开发版 | 体验版 | 正式版 |
|------|--------|--------|--------|
| 受众 | 项目成员 | 体验成员（扫码） | 所有微信用户 |
| 域名校验 | 可关闭校验 | **必须**合法域名 | **必须** |
| 代码来源 | 开发者工具上传 | 同左，选体验 | 审核通过后发布 |
| 微信支付 | 可用真实商户号小额自测 | 同左 | 全量 |
| 「沙箱」 | 微信支付旧沙箱**不覆盖**完整小程序 JSAPI 流程；实务上用**真实商户号 + 0.01 元订单**自测，或商户平台测试能力 | — | — |
| referer | version=0 | version=0 | 正式版本号 |

支付验收参考：[支付验收指引](https://pay.weixin.qq.com/doc/v2/merchant/4011984810)、[小程序支付开发指引](https://pay.weixin.qq.com/doc/v3/merchant/4012791911)。

**建议流程**：开发版联调 → 上传体验版给运营/客服走完整购物 → 提交审核 → 通过后全量发布。审核中勿随意改类目/主体。

---

## 7. 提审常见驳回原因（购物类重点）

综合 [常见拒绝情形](https://developers.weixin.qq.com/miniprogram/product/reject) 与 [交易类运营规范](https://developers.weixin.qq.com/miniprogram/product/jiaoyilei/yunyingguifan.html)：

1. **类目/资质不符**：选了电商类目但页面是空壳；或缺食品经营许可等。  
2. **非完整可运行产品**：崩溃、按钮无响应、核心链路不通；有账号体系却未提供可测账号。  
3. **测试/演示痕迹**：测试商品、「演示」「假支付」、无法真实履约。  
4. **诱导分享/关注**、夸张营销、绝对化用语、空白广告位。  
5. **隐私不合规**：未配置隐私指引、未说明手机号/地址用途、未授权展示头像昵称。  
6. **类目入口不可达**：首页 2 次点击内到不了所报类目服务页。  
7. **支付/售后残缺**：只展示商品不能下单支付，或售后入口缺失。  
8. **禁售/虚假宣传**：仿冒品牌、价格异常、禁发商品。  
9. **发货能力未就绪**：实物电商未准备发货管理与真实物流（上线后违规会停交易）。  
10. **名称/简介/Logo**：侵权、模糊简介、Logo 不清或含微信官方标识。

**提审前自检**：提供测试账号；准备 2–3 件真实商品；打通支付（可用小额）；隐私与协议页齐全；简介写清「浏览商品、下单、微信支付、订单与售后」。

---

## 8. 分阶段实施计划

### Phase 0 · 用户准备（约 1–3 周，视备案）

**负责人：用户（L FA）**

- 购买大陆云服务器（建议华北/华东，与用户群近）+ 域名。  
- 完成域名 ICP 备案 + 小程序备案材料提交。  
- 注册企业小程序并微信认证；选定类目、上传资质。  
- 申请微信支付商户号并绑定 AppID；开通 APIv3、下载证书。  
- 准备隐私政策文案、客服联系方式、真实商品与物流商。  

**产出**：可解析的 `https://已备案域名`、AppID/Secret、mchid、证书。

### Phase 1 · 后端 `/api/mp`（约 1.5–2.5 人周）

**负责人：开发（Grok Bot / 工程）**

- users 增加 openid；token 会话；CSRF 对 `/api/mp` 豁免并改鉴权。  
- 实现登录、手机号、商品、购物车、报价、下单、订单、地址、券、售后等 JSON。  
- 复用 `svc.quote` / `createOrder` 等；管理后台发货钩子预留。  
- 部署到大陆机（pm2 + Nginx + HTTPS），配置合法域名联调。  

### Phase 2 · 小程序 UI（约 2–3 人周）

**负责人：开发**

- 原生小程序工程：首页、分类、详情、购物车、结算、订单、我的、地址、售后、协议页。  
- 统一 request 封装（带 token、错误码）。  
- 体验版给用户验收。  

### Phase 3 · 微信支付 + 发货（约 1–1.5 人周）

**负责人：开发 + 用户（商户平台配置）**

- JSAPI 下单、`wx.requestPayment`、回调验签解密、退款对接。  
- 后台发货调用 `upload_shipping_info`。  
- 0.01 元真实支付与退款演练。  

### Phase 4 · 提审与发布（约 3–10 个工作日含审核排队）

**负责人：用户主导提交；开发修驳回**

- 完善类目页、测试账号、隐私指引、去演示文案。  
- 提交审核 → 处理驳回 → 发布正式版。  
- 监控支付回调、发货时效、客诉。  

**合计粗算**：在备案已完成前提下，技术侧约 **5–8 人周**；备案与认证并行可缩短日历时间。

---

## 9. 香港/境外服务器做不到的事

| 事项 | 原因 |
|------|------|
| 用香港/海外域名当 request 合法域名 | 官方要求域名**必须 ICP 备案**；港/海外主体域名通常无法按大陆 ICP 规则备案用于此场景 |
| 继续用 Render / 海外 VPS 作生产 API | 无法满足合法域名 + 备案；大陆访问延迟与可用性也不适合 |
| 境内微信支付商户结算到境外账户 | 境内商户进件要求大陆对公（或规定的）银行账户；跨境/境外商户是另一套产品与资质 |
| 跳过小程序备案 | 政策要求；未备案影响上架与服务 |
| 在小程序前端直存 AppSecret 调微信 API | 明文禁止；且域名不能配 `api.weixin.qq.com` |
| 自签名证书 / 仅 TLS1.0 | iOS 与官方校验会失败 |
| 无发货管理的长期实物交易 | 平台会警告直至**暂停交易** |

**可行折中（仅开发）**：本地/海外机开发时用开发者工具「不校验域名」；**上体验版前必须切到大陆已备案域名**。  
用户人在老挝：可用 SSH/VPN 管理大陆云；小程序后台与商户平台用境内实名微信号操作（通常由国内法人/管理员协助）。

---

## 10. 官方文档索引

| 主题 | URL |
|------|-----|
| 小程序介绍与主体 | https://developers.weixin.qq.com/miniprogram/introduction/ |
| 服务类目 | https://developers.weixin.qq.com/miniprogram/product/material |
| 类目资质 | https://developers.weixin.qq.com/miniprogram/product/mini-store/leimuzizhi/qiyeleimu.html |
| 备案指引 | https://developers.weixin.qq.com/miniprogram/product/record/guidelines |
| 网络/合法域名 | https://developers.weixin.qq.com/miniprogram/dev/framework/ability/network.html |
| 隐私指引 | https://developers.weixin.qq.com/miniprogram/dev/framework/user-privacy/ |
| 登录 | https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/login |
| code2Session | https://developers.weixin.qq.com/miniprogram/dev/server/API/user-login/api_code2session |
| 手机号组件 | https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/getPhoneNumber.html |
| 绑定支付 | https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/bind/bind-wxpay.html |
| 小程序支付进件 | https://pay.weixin.qq.com/static/applyment_guide/applyment_detail_miniapp.shtml |
| JSAPI 下单 | https://pay.weixin.qq.com/doc/v3/merchant/4012791856 |
| 支付回调 | https://pay.weixin.qq.com/doc/v3/merchant/4012791861 |
| wx.requestPayment | https://developers.weixin.qq.com/miniprogram/dev/api/payment/wx.requestPayment.html |
| 交易类规范 | https://developers.weixin.qq.com/miniprogram/product/jiaoyilei/yunyingguifan.html |
| 发货管理 | https://developers.weixin.qq.com/miniprogram/product/jiaoyilei/fahuoguanligongneng.html |
| 发货 API | https://developers.weixin.qq.com/miniprogram/dev/server/API/order_shipping/api_uploadshippinginfo.html |
| 常见拒绝 | https://developers.weixin.qq.com/miniprogram/product/reject |

---

## 附录 A · 与现有仓库的关系

- 演示说明见仓库 `README.md`：支付/短信/物流均为模拟。  
- 生产部署（pm2 + Nginx + HTTPS）README 已有模板，**迁移到大陆机时沿用**，并设置强 `SESSION_SECRET`、改默认管理员密码。  
- 本手册不替代法务意见；食品、进口等垂直品类请按类目表单独备证。

## 附录 B · 推荐首期范围（MVP）

登录（openid+手机号）→ 商品浏览 → 购物车 → 地址 → 下单 → 微信支付 → 订单列表 → 确认收货 → 售后申请 → 后台发货并同步微信。  

二期再做：秒杀、拼团、积分商城、分销、订阅消息、完整快递 API。

---

*文档维护：随微信规则更新；重大政策以 mp.weixin.qq.com / pay.weixin.qq.com 公示为准。*
