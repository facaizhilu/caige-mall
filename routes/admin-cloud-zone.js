const db=require('../lib/db'),U=require('../lib/util'),Z=require('../lib/cloud-zone'),J=require('../lib/suppliers/jdvop');
module.exports=(r,{need,flash,log,filesOf})=>{
 const cats=()=>db.all('SELECT c.*,p.name parent_name FROM categories c LEFT JOIN categories p ON p.id=c.parent_id WHERE c.parent_id>0 AND c.status=1 ORDER BY c.sort,c.id');
 const form=(res,p)=>res.page('admin/cloud-zone-form',{title:p.id?'编辑云商专区商品':'添加云商专区商品',p,cats:cats(),tpls:db.all('SELECT * FROM shipping_templates ORDER BY id')});
 r.post('/members/:id/cloud-zone',need('member'),(req,res)=>{
  const id=U.int(req.params.id),on=req.body.enabled==='1';
  if(!Z.setMember(id,on))flash(req,'error','会员不存在、已禁用或已注销');
  else {log(req,on?'开启云商专区资格':'关闭云商专区资格','#'+id);flash(req,'success',on?'云商专区资格已开启，请会员从云商卡页面验证进入':'云商专区资格已关闭，原有访问授权立即失效');}
  res.redirect('/admin/members/'+id+'#cloud-zone');
 });
 r.get('/cloud-zone-products',need('product'),(req,res)=>{
  const pg=U.paginate('SELECT p.*,c.name category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.cloud_zone=1 ORDER BY p.id DESC',[],req.query.page,20);
  res.page('admin/cloud-zone-products',{title:'云商专区商品',pg});
 });
 r.get('/cloud-zone-products/new',need('product'),(req,res)=>form(res,{name:'',description:'',price:'',stock:0,status:0,no_reason_return:1,images:'[]'}));
 r.get('/cloud-zone-products/:id/edit',need('product'),(req,res)=>{
  const p=db.get('SELECT * FROM products WHERE id=? AND cloud_zone=1',U.int(req.params.id));if(!p)return res.status(404).send('专区商品不存在');
  form(res,p);
 });
 r.post('/cloud-zone-products/save',need('product'),(req,res)=>{
  const b=req.body,id=U.int(b.id),old=id?db.get('SELECT * FROM products WHERE id=? AND cloud_zone=1 AND supplier IS NULL',id):null;
  if(id&&!old)return res.status(404).send('专区商品不存在');
  const row={name:String(b.name||'').trim().slice(0,120),description:String(b.description||'').trim().slice(0,10000),category_id:U.int(b.category_id),template_id:U.int(b.template_id),price:U.round2(Number(b.price)),stock:Number(b.stock),status:b.status==='1'?1:0,no_reason_return:b.no_reason_return==='0'?0:1,sort:U.int(b.sort),cloud_zone:1};
  const fail=m=>{res.locals.flash={type:'error',msg:m};form(res,{...row,id,images:old?old.images:'[]'});};
  const c=cats().find(c=>c.id===row.category_id);if(!c)return fail('请选择有效的二级商品分类');
  const scope=J.compliance.scopeWarning([c.parent_name,c.name]);if(scope)return fail('经营范围不符，不能添加该类商品：'+scope.msg);
  if(!row.name)return fail('请填写商品名称');
  if(J.compliance.titleScope(row.name))return fail('商品名称含经营范围外商品，请核实分类与商品');
  if(!Number.isFinite(row.price)||row.price<=0||row.price>20000)return fail('售价必须大于0且不超过20000元');
  if(!Number.isSafeInteger(row.stock)||row.stock<0||row.stock>1000000)return fail('库存需为0至1000000的整数');
  if(!db.get('SELECT 1 FROM shipping_templates WHERE id=?',row.template_id))return fail('请选择有效运费模板');
  const hits=require('../lib/banned').checkProduct(row,[]);if(hits.length)return fail('请先修改敏感或违禁表述：'+require('../lib/banned').summarize(hits));
  let image=String(b.image_url||'').trim();const uploads=filesOf(req,'image_files');if(uploads.length)image=uploads[0];
  if(image){let safe=/^\/(static|uploads)\//.test(image);try{const url=new URL(image);safe=url.protocol==='https:'&&!url.username&&!url.password;}catch{}if(!safe)return fail('图片仅支持本站上传文件或HTTPS地址');}
  row.images=image?JSON.stringify([image]):(old?old.images:'[]');
  db.transaction(()=>{
   const keys=Object.keys(row);let pid=id;
   if(old)db.exec1('UPDATE products SET '+keys.map(k=>k+'=?').join(',')+' WHERE id=?',...keys.map(k=>row[k]),id);
   else {row.created_at=U.now();row.spec_names='规格';row.weight=0.5;const ks=Object.keys(row);pid=Number(db.exec1('INSERT INTO products('+ks.join(',')+')VALUES('+ks.map(()=>'?').join(',')+')',...ks.map(k=>row[k])).lastInsertRowid);}
   const sku=db.get('SELECT id FROM skus WHERE product_id=? ORDER BY id LIMIT 1',pid);
   if(sku)db.exec1('UPDATE skus SET price=?,stock=? WHERE id=?',row.price,row.stock,sku.id);
   else db.exec1('INSERT INTO skus(product_id,attrs,spec_text,price,stock)VALUES(?,?,?,?,?)',pid,'{"规格":"默认"}','默认',row.price,row.stock);
   log(req,old?'编辑云商专区商品':'添加云商专区商品','#'+pid+' '+row.name);
  })();
  flash(req,'success','云商专区商品已保存，不会显示到普通商城');res.redirect('/admin/cloud-zone-products');
 });
 r.post('/cloud-zone-products/:id/toggle',need('product'),(req,res)=>{
  const p=db.get('SELECT * FROM products WHERE id=? AND cloud_zone=1',U.int(req.params.id));if(!p)return res.status(404).send('专区商品不存在');
  const c=cats().find(c=>c.id===p.category_id);const hits=require('../lib/banned').checkProduct(p,[]);
  if(!p.status&&(!c||J.compliance.scopeWarning([c.parent_name,c.name])||hits.length||J.compliance.titleScope(p.name)||!(p.price>0&&p.price<=20000))){flash(req,'error','商品需先通过分类、价格及文案检查');return res.redirect('/admin/cloud-zone-products');}
  db.exec1('UPDATE products SET status=1-status WHERE id=?',p.id);log(req,'云商专区商品上下架','#'+p.id);res.redirect('/admin/cloud-zone-products');
 });
 r.post('/cloud-zone-products/:id/delete',need('product'),(req,res)=>{
  const id=U.int(req.params.id);if(!db.get('SELECT 1 FROM products WHERE id=? AND cloud_zone=1',id))return res.status(404).send('专区商品不存在');
  if(db.get('SELECT 1 FROM order_items WHERE product_id=?',id)){flash(req,'error','已有订单的商品不能删除，请下架');return res.redirect('/admin/cloud-zone-products');}
  db.transaction(()=>{db.exec1('DELETE FROM skus WHERE product_id=?',id);db.exec1('DELETE FROM products WHERE id=? AND cloud_zone=1',id);})();log(req,'删除云商专区商品','#'+id);res.redirect('/admin/cloud-zone-products');
 });
};
