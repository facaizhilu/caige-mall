// 供应商对接表结构(幂等迁移)
module.exports = function migrate(db) {
  const colsOf = t => new Set(db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name));
  const addCol = (t, col, def) => { if (!colsOf(t).has(col)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${col} ${def}`); };
  // 商品:供应商来源、成本价(结算价)、供应商建议零售价(仅后台参考)、同步状态
  addCol('products', 'supplier', 'TEXT');               // NULL=自营,'jdvop'=供应商商品
  addCol('products', 'supplier_spu', 'TEXT');
  addCol('products', 'supplier_cat', 'TEXT');           // 供应商三级分类 ID
  addCol('products', 'is_perishable', 'INTEGER DEFAULT 0');
  addCol('products', 'supplier_state', 'TEXT');         // ok / auto_delisted / removed
  addCol('products', 'supplier_sync_at', 'TEXT');
  addCol('products', 'supplier_review_note', 'TEXT');   // 导入审核提示(违禁词等),需人工修改后才能上架
  addCol('skus', 'supplier_sku', 'TEXT');
  addCol('skus', 'cost_price', 'REAL');                 // 供应商结算价(成本)
  addCol('skus', 'supplier_retail', 'REAL');            // 供应商建议零售价(京东价),仅用于加价规则,不作划线价展示
  addCol('skus', 'return_rule_type', 'INTEGER');
  addCol('order_items', 'supplier', 'TEXT');
  addCol('order_items', 'supplier_sku', 'TEXT');
  addCol('order_items', 'cost_price', 'REAL');
  addCol('orders', 'supplier_freight', 'REAL DEFAULT 0');  // 结算时向供应商查询的运费(已计入订单运费)
  addCol('orders', 'supplier_area', 'TEXT');               // 结算时转换的四级地址 JSON
  addCol('orders', 'own_shipped_at', 'TEXT');              // 混合订单:自营部分发货时间
  addCol('aftersales', 'supplier', 'TEXT');
  addCol('aftersales', 'supplier_afs_sn', 'TEXT');
  addCol('aftersales', 'supplier_child_sn', 'TEXT');
  addCol('aftersales', 'supplier_sku', 'TEXT');
  addCol('aftersales', 'supplier_qty', 'INTEGER');
  addCol('aftersales', 'supplier_afs_type', 'INTEGER');
  addCol('aftersales', 'supplier_pick_type', 'INTEGER');
  addCol('aftersales', 'supplier_status', 'TEXT');         // JSON:queryAfs 最新结果
  addCol('aftersales', 'supplier_refund_amount', 'REAL');
  addCol('aftersales', 'supplier_refunded_at', 'TEXT');
  db.exec(`
CREATE TABLE IF NOT EXISTS supplier_orders(
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL, supplier TEXT NOT NULL DEFAULT 'jdvop',
  out_order_sn TEXT, order_sn TEXT, sys_order_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending 待推送 / submitted 已预下单 / confirmed 已确认 / failed 失败(已退款) / cancelling 取消中 / cancelled 已取消
  remote_status INTEGER, deduction_price REAL, settlement_price REAL, sku_total REAL, freight REAL, charge_fee REAL,
  sale_amount REAL DEFAULT 0, refunded_customer REAL DEFAULT 0, supplier_refund REAL DEFAULT 0,
  error TEXT, attempts INTEGER DEFAULT 0, next_try_at TEXT, last_polled_at TEXT, created_at TEXT, updated_at TEXT,
  UNIQUE(order_id, supplier)
);
CREATE TABLE IF NOT EXISTS order_packages(
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL, source TEXT NOT NULL,   -- own 自营 / jdvop 供应商
  child_order_sn TEXT, company TEXT, tracking_nos TEXT DEFAULT '[]', items TEXT DEFAULT '[]',
  status TEXT DEFAULT 'created', remote_status INTEGER, delivered INTEGER DEFAULT 0,
  shipped_at TEXT, delivered_at TEXT, created_at TEXT, updated_at TEXT,
  UNIQUE(order_id, source, child_order_sn)
);
CREATE INDEX IF NOT EXISTS idx_pkg_order ON order_packages(order_id);
CREATE TABLE IF NOT EXISTS supplier_callbacks(
  id INTEGER PRIMARY KEY, supplier TEXT, dedup_key TEXT UNIQUE, type TEXT, payload TEXT, result TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS supplier_call_logs(
  id INTEGER PRIMARY KEY, supplier TEXT, mode TEXT, interface_code TEXT, ok INTEGER, code TEXT, msg TEXT,
  duration_ms INTEGER, request TEXT, response TEXT, created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_call_logs_created ON supplier_call_logs(created_at);
CREATE TABLE IF NOT EXISTS supplier_category_map(
  supplier TEXT NOT NULL, supplier_cat_id TEXT NOT NULL, supplier_cat_name TEXT, supplier_path TEXT,
  category_id INTEGER, perishable INTEGER DEFAULT 0, reviewed INTEGER DEFAULT 0, updated_at TEXT,
  PRIMARY KEY(supplier, supplier_cat_id)
);
CREATE TABLE IF NOT EXISTS supplier_alerts(
  id INTEGER PRIMARY KEY, supplier TEXT, level TEXT DEFAULT 'error', order_id INTEGER, message TEXT, resolved INTEGER DEFAULT 0, created_at TEXT
);
CREATE TABLE IF NOT EXISTS jdvop_mock_state(kind TEXT NOT NULL, k TEXT NOT NULL, data TEXT, PRIMARY KEY(kind, k));
CREATE INDEX IF NOT EXISTS idx_products_supplier ON products(supplier);
CREATE INDEX IF NOT EXISTS idx_skus_supplier ON skus(supplier_sku);
`);
  const defaults = { jdvop_markup_mode: 'max_retail_cost', jdvop_markup_pct: '10', jdvop_sync_hours: '6', jdvop_poll_minutes: '10', jdvop_virtual_stock: '200', jdvop_mock_auto: '0', jdvop_max_push_attempts: '3', jdvop_blocklist: require('./compliance').BLOCKLIST_DEFAULT };
  for (const [k, v] of Object.entries(defaults)) db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)').run(k, v);
  // 禁售清单仍是旧版默认值(未被管理员修改过)→ 更新为当前默认(按经营范围开放首批类目)
  const C = require('./compliance'), cur = db.prepare("SELECT value FROM settings WHERE key='jdvop_blocklist'").get();
  if (cur && C.BLOCKLIST_OLD_DEFAULTS.includes(cur.value)) db.prepare("UPDATE settings SET value=? WHERE key='jdvop_blocklist'").run(C.BLOCKLIST_DEFAULT);
};
