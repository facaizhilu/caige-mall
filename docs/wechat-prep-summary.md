# 财哥商城 · 微信小程序筹备速记

> 一页纸 recall · 2026-10-05 · 详版见同目录 `wechat-miniprogram-launch.md`

## 目标与约束

- 现站：Express + SQLite + EJS（`caige-mall`），Render 演示，**支付/短信/物流均为模拟**。
- 目标：大陆正式小程序 + 微信支付；运营在老挝，客户在大陆。
- 用户自备：营业执照/合规、**大陆云+域名+ICP（含小程序备案）**。

## 架构一句话

保留 Express 业务（`lib/svc.js`）与 `/admin`；新增 `/api/mp/*` JSON；前端用**原生微信小程序**（单端微信、无 Vue 存量，比 uni-app 更合适）。

## 硬前置（用户）

1. 企业小程序注册 + 微信认证  
2. 类目与商品资质  
3. 大陆服务器 + 域名 ICP + 小程序备案  
4. 合法域名（request/uploadFile/downloadFile）+ TLS1.2+  
5. 微信支付商户号绑定 AppID；隐私指引  

**香港/海外/Render 不能当生产 API 域名**（须 ICP 备案域名）。

## 必建能力（相对现码）

| 已有可包 JSON | 必须新建 |
|--------------|----------|
| 商品/购物车/quote/下单/订单/地址/券/售后 | code2session、手机号、token 鉴权 |
| 库存事务、后台发货 | 微信支付统一下单+回调、微信发货信息录入 |

首期建议砍：秒杀/拼团/积分商城/分销/余额充值。

## 阶段与粗工期

| Phase | 内容 | 谁 | 粗工期 |
|-------|------|----|--------|
| 0 | 云/域名/备案/认证/商户号 | 用户 | 1–3 周 |
| 1 | `/api/mp` + 大陆部署 | 开发 | 1.5–2.5 人周 |
| 2 | 小程序 UI | 开发 | 2–3 人周 |
| 3 | 支付+发货同步 | 双方 | 1–1.5 人周 |
| 4 | 提审发布 | 用户主提交 | 数个工作日+ |

## 提审雷区

非完整闭环、演示商品、无测试号、类目不符、隐私未配、诱导分享、绝对化用语、实物未接发货管理。

## 关键官方链

- 域名：https://developers.weixin.qq.com/miniprogram/dev/framework/ability/network.html  
- 登录：https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/login  
- 支付下单：https://pay.weixin.qq.com/doc/v3/merchant/4012791856  
- 交易规范：https://developers.weixin.qq.com/miniprogram/product/jiaoyilei/yunyingguifan.html  
- 拒审：https://developers.weixin.qq.com/miniprogram/product/reject  

## Top 行动项

**用户**：买大陆云与域名并备案；注册认证小程序；申请/绑定微信支付；备真实商品与隐私文案。  
**开发**：设计 `/api/mp` + openid 用户模型；原生小程序；接支付与发货 API；协助过审修驳回。
