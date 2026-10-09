const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const dir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(dir, { recursive: true });
const db = new Database(path.join(dir, 'mall.db'));
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS member_levels(id INTEGER PRIMARY KEY, name TEXT, min_growth INTEGER DEFAULT 0, discount INTEGER DEFAULT 100, color TEXT DEFAULT '#999999', remark TEXT, sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, phone TEXT UNIQUE, password_hash TEXT, nickname TEXT, gender TEXT DEFAULT '保密', points INTEGER DEFAULT 0, growth INTEGER DEFAULT 0, level_id INTEGER DEFAULT 1, status INTEGER DEFAULT 1, invite_code TEXT UNIQUE, referrer_id INTEGER, remark TEXT, created_at TEXT, last_login TEXT, signin_streak INTEGER DEFAULT 0, last_signin TEXT, total_spent REAL DEFAULT 0);
CREATE TABLE IF NOT EXISTS addresses(id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, phone TEXT, province TEXT, city TEXT, district TEXT, detail TEXT, is_default INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS categories(id INTEGER PRIMARY KEY, name TEXT, parent_id INTEGER DEFAULT 0, icon TEXT, sort INTEGER DEFAULT 0, status INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS brands(id INTEGER PRIMARY KEY, name TEXT, description TEXT, color TEXT DEFAULT '#d4202a', sort INTEGER DEFAULT 0, status INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS shipping_templates(id INTEGER PRIMARY KEY, name TEXT, free_over REAL DEFAULT 0, rules TEXT, remark TEXT);
CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY, name TEXT, subtitle TEXT, category_id INTEGER, brand_id INTEGER, price REAL, market_price REAL, stock INTEGER DEFAULT 0, sales INTEGER DEFAULT 0, description TEXT, images TEXT DEFAULT '[]', status INTEGER DEFAULT 1, is_hot INTEGER DEFAULT 0, is_new INTEGER DEFAULT 0, template_id INTEGER DEFAULT 1, weight REAL DEFAULT 0.5, spec_names TEXT DEFAULT '', sort INTEGER DEFAULT 0, created_at TEXT);
CREATE TABLE IF NOT EXISTS skus(id INTEGER PRIMARY KEY, product_id INTEGER, attrs TEXT DEFAULT '{}', spec_text TEXT, price REAL, stock INTEGER DEFAULT 0, code TEXT);
CREATE TABLE IF NOT EXISTS cart(id INTEGER PRIMARY KEY, user_id INTEGER, sku_id INTEGER, qty INTEGER DEFAULT 1, created_at TEXT, UNIQUE(user_id, sku_id));
CREATE TABLE IF NOT EXISTS favorites(user_id INTEGER, product_id INTEGER, created_at TEXT, PRIMARY KEY(user_id, product_id));
CREATE TABLE IF NOT EXISTS history(user_id INTEGER, product_id INTEGER, viewed_at TEXT, PRIMARY KEY(user_id, product_id));
CREATE TABLE IF NOT EXISTS keywords(id INTEGER PRIMARY KEY, word TEXT UNIQUE, hits INTEGER DEFAULT 0, is_hot INTEGER DEFAULT 0, sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS reviews(id INTEGER PRIMARY KEY, product_id INTEGER, order_id INTEGER, order_item_id INTEGER, user_id INTEGER, rating INTEGER DEFAULT 5, content TEXT, status TEXT DEFAULT 'pending', reply TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY, order_no TEXT UNIQUE, user_id INTEGER, type TEXT DEFAULT 'normal', status TEXT DEFAULT 'unpaid', goods_amount REAL DEFAULT 0, freight REAL DEFAULT 0, level_discount REAL DEFAULT 0, coupon_discount REAL DEFAULT 0, points_discount REAL DEFAULT 0, points_used INTEGER DEFAULT 0, pay_amount REAL DEFAULT 0, pay_method TEXT, paid_at TEXT, receiver TEXT, phone TEXT, province TEXT, city TEXT, district TEXT, detail TEXT, remark TEXT, user_coupon_id INTEGER, express_company TEXT, tracking_no TEXT, shipped_at TEXT, completed_at TEXT, cancelled_at TEXT, cancel_reason TEXT, group_id INTEGER, promo_id INTEGER, admin_remark TEXT, points_awarded INTEGER DEFAULT 0, growth_awarded INTEGER DEFAULT 0, created_at TEXT);
CREATE TABLE IF NOT EXISTS order_items(id INTEGER PRIMARY KEY, order_id INTEGER, product_id INTEGER, sku_id INTEGER, name TEXT, spec_text TEXT, image TEXT, price REAL, qty INTEGER, reviewed INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS traces(id INTEGER PRIMARY KEY, order_id INTEGER, time TEXT, text TEXT);
CREATE TABLE IF NOT EXISTS coupons(id INTEGER PRIMARY KEY, name TEXT, threshold REAL DEFAULT 0, amount REAL DEFAULT 0, total INTEGER DEFAULT 100, claimed INTEGER DEFAULT 0, per_limit INTEGER DEFAULT 1, valid_days INTEGER DEFAULT 30, category_id INTEGER DEFAULT 0, status INTEGER DEFAULT 1, description TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS user_coupons(id INTEGER PRIMARY KEY, user_id INTEGER, coupon_id INTEGER, status TEXT DEFAULT 'unused', order_id INTEGER, expire_at TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS banners(id INTEGER PRIMARY KEY, title TEXT, subtitle TEXT, image TEXT, link TEXT, bg1 TEXT DEFAULT '#d4202a', bg2 TEXT DEFAULT '#f2a93b', sort INTEGER DEFAULT 0, status INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS seckills(id INTEGER PRIMARY KEY, product_id INTEGER, sku_id INTEGER, price REAL, stock INTEGER, sold INTEGER DEFAULT 0, start_at TEXT, end_at TEXT, limit_per_user INTEGER DEFAULT 1, status INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS groupbuys(id INTEGER PRIMARY KEY, product_id INTEGER, sku_id INTEGER, price REAL, size INTEGER DEFAULT 2, hours INTEGER DEFAULT 24, status INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS groups(id INTEGER PRIMARY KEY, groupbuy_id INTEGER, leader_id INTEGER, need INTEGER, joined INTEGER DEFAULT 0, status TEXT DEFAULT 'open', expire_at TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS group_members(id INTEGER PRIMARY KEY, group_id INTEGER, user_id INTEGER, order_id INTEGER);
CREATE TABLE IF NOT EXISTS points_goods(id INTEGER PRIMARY KEY, name TEXT, image TEXT, points INTEGER, type TEXT DEFAULT 'goods', coupon_id INTEGER DEFAULT 0, stock INTEGER DEFAULT 0, exchanged INTEGER DEFAULT 0, status INTEGER DEFAULT 1, description TEXT, sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS points_log(id INTEGER PRIMARY KEY, user_id INTEGER, delta INTEGER, balance INTEGER, reason TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS signins(user_id INTEGER, day TEXT, points INTEGER, streak INTEGER, PRIMARY KEY(user_id, day));
CREATE TABLE IF NOT EXISTS commissions(id INTEGER PRIMARY KEY, user_id INTEGER, from_user_id INTEGER, order_id INTEGER, amount REAL, status TEXT DEFAULT 'available', created_at TEXT, settled_at TEXT);
CREATE TABLE IF NOT EXISTS aftersales(id INTEGER PRIMARY KEY, order_id INTEGER, user_id INTEGER, type TEXT, reason TEXT, description TEXT, amount REAL, status TEXT DEFAULT 'pending', admin_note TEXT, return_express TEXT, return_tracking TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS invoices(id INTEGER PRIMARY KEY, order_id INTEGER, user_id INTEGER, type TEXT DEFAULT 'personal', title TEXT, tax_no TEXT, email TEXT, amount REAL, status TEXT DEFAULT 'pending', invoice_no TEXT, admin_note TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS articles(id INTEGER PRIMARY KEY, category TEXT DEFAULT 'help', topic TEXT, title TEXT, content TEXT, status INTEGER DEFAULT 1, sort INTEGER DEFAULT 0, views INTEGER DEFAULT 0, created_at TEXT);
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY, user_id INTEGER, sender TEXT, content TEXT, created_at TEXT, is_read INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS sms_codes(id INTEGER PRIMARY KEY, phone TEXT, code TEXT, purpose TEXT, created_at TEXT, used INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS roles(id INTEGER PRIMARY KEY, name TEXT, permissions TEXT DEFAULT '', remark TEXT);
CREATE TABLE IF NOT EXISTS admins(id INTEGER PRIMARY KEY, username TEXT UNIQUE, password_hash TEXT, name TEXT, role_id INTEGER, status INTEGER DEFAULT 1, last_login TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS admin_logs(id INTEGER PRIMARY KEY, admin_id INTEGER, admin_name TEXT, action TEXT, detail TEXT, ip TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS sessions(sid TEXT PRIMARY KEY, sess TEXT, expire INTEGER);
CREATE INDEX IF NOT EXISTS idx_products_cat ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_skus_product ON skus(product_id);
`);

db.all = (sql, ...p) => db.prepare(sql).all(...p);
db.get = (sql, ...p) => db.prepare(sql).get(...p);
db.exec1 = (sql, ...p) => db.prepare(sql).run(...p);

// ---- 云商卡相关表与用户字段(幂等迁移) ----
db.exec(`
CREATE TABLE IF NOT EXISTS cloud_card_types(
  id INTEGER PRIMARY KEY,
  tier TEXT NOT NULL,
  duration TEXT NOT NULL,
  name TEXT NOT NULL,
  activation_fee REAL DEFAULT 0,
  product_id INTEGER DEFAULT 0,
  status INTEGER DEFAULT 1,
  sort INTEGER DEFAULT 0,
  remark TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS cloud_referral_log(
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  from_user_id INTEGER,
  order_id INTEGER,
  product_id INTEGER,
  amount REAL DEFAULT 0,
  points INTEGER DEFAULT 0,
  type TEXT NOT NULL,
  note TEXT DEFAULT '',
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS cloud_redeem_requests(
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  points INTEGER NOT NULL,
  note TEXT DEFAULT '',
  status TEXT DEFAULT 'pending',
  admin_note TEXT DEFAULT '',
  created_at TEXT,
  handled_at TEXT,
  handled_by INTEGER
);
CREATE TABLE IF NOT EXISTS cloud_daily_log(
  user_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  points INTEGER DEFAULT 0,
  PRIMARY KEY(user_id, day)
);
CREATE INDEX IF NOT EXISTS idx_cloud_ref_user ON cloud_referral_log(user_id);
CREATE INDEX IF NOT EXISTS idx_cloud_redeem_status ON cloud_redeem_requests(status);
`);
(function ensureUserCloudCols() {
  const cols = new Set(db.prepare('PRAGMA table_info(users)').all().map(c => c.name));
  const add = (col, def) => { if (!cols.has(col)) db.exec(`ALTER TABLE users ADD COLUMN ${col} ${def}`); };
  add('cloud_tier', "TEXT DEFAULT ''");
  add('cloud_start', 'TEXT');
  add('cloud_end', 'TEXT');
  add('cloud_card_type_id', 'INTEGER DEFAULT 0');
  add('cloud_daily_day', 'TEXT');
  add('cloud_push3_granted', 'INTEGER DEFAULT 0');
})();


// ---- 合规改造(幂等迁移):删除生日/余额/评价与售后图片,新增隐私同意、注销、七天无理由、售后退款拆分 ----
(function complianceMigration() {
  const colsOf = t => new Set(db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name));
  const addCol = (t, col, def) => { if (!colsOf(t).has(col)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${col} ${def}`); };
  const dropCol = (t, col, nullSql) => {
    if (!colsOf(t).has(col)) return;
    try { db.exec(`ALTER TABLE ${t} DROP COLUMN ${col}`); } catch (e) { if (nullSql) db.exec(nullSql); }
  };
  dropCol('users', 'birthday', 'UPDATE users SET birthday=NULL');
  dropCol('users', 'balance', 'UPDATE users SET balance=0');
  dropCol('reviews', 'images', "UPDATE reviews SET images='[]'");
  dropCol('aftersales', 'images', "UPDATE aftersales SET images='[]'");
  db.exec('DROP TABLE IF EXISTS balance_log; DROP TABLE IF EXISTS recharges;');
  addCol('users', 'consent_at', 'TEXT');            // 同意《用户协议》《隐私政策》的时间
  addCol('users', 'consent_version', 'TEXT');       // 同意时的政策版本号
  addCol('users', 'cancelled_at', 'TEXT');          // 注销时间(注销后 status=0)
  addCol('aftersales', 'refund_channel', 'TEXT');   // 退款去向:原路退回
  addCol('aftersales', 'refunded_at', 'TEXT');
  addCol('aftersales', 'refund_points', 'INTEGER DEFAULT 0'); // 售后退回积分
  addCol('aftersales', 'refund_cash', 'REAL DEFAULT 0');      // 售后退回现金(原路退回)
  addCol('aftersales', 'created_by', 'TEXT');       // 创建人(客服账号)
  addCol('categories', 'no_7day', 'INTEGER DEFAULT 0');  // 1=鲜活易腐类,默认不支持七天无理由
  addCol('products', 'no_reason_return', 'INTEGER');     // NULL=跟随分类,1=支持,0=不支持
  addCol('orders', 'no7_confirmed', 'INTEGER DEFAULT 0'); // 下单时已确认「不支持7天无理由」
})();

module.exports = db;
