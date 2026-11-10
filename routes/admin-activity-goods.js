// 活动专区商品:后台直接上传自定义商品和活动价,只在前台「活动专区」显示(不进首页/分类/搜索/普通购物车)
const db=require('../lib/db'),U=require('../lib/util'),J=require('../lib/suppliers/jdvop'),B=require('../lib/banned');
module.exports=(r,{need,flash,log,filesOf})=>{
 const cats=()=>db.all('SELECT c.*,p.name parent_name FROM categories c LEFT JOIN categories p ON p.id=c.parent_id WHERE c.parent_id>0 AND c.status=1 ORDER BY c.sort,c.id');
 const tpls=()=>db.all('SELECT * FROM shipping_templates ORDER BY id');
 const f16=s=>String(s||'').slice(0,16).replace(' ','T');
 const dt=s=>s?String(s).replace('T',' ').slice(0,16)+':00':'';
 const local=ms=>{const d=new Date(ms),z=n=>String(n).padStart(2,'0');return d.getFullYear()+'-'+z(d.getMonth()+1)+'-'+z(d.getDate())+'T'+z(d.getHours())+':'+z(d.getMinutes());};
 const get=id=>{const p=db.get('SELECT * FROM products WHERE id=? AND activity_only=1',id);if(!p)return null;const sk=db.get('SELECT * FROM seckills WHERE product_id=? ORDER BY id LIMIT 1',p.id)||{};return{...p,price:sk.price!=null?sk.price:p.price,stock:sk.stock!=null?sk.stock:p.stock,sold:sk.sold||0,start_at:f16(sk.start_at),end_at:f16(sk.end_at),limit_per_user:sk.limit_per_user||1,on:sk.status?1:0,sk_id:sk.id,image:U.jsonArr(p.images)[0]||''};};
 const form=(res,p,errs={})=>res.page('admin/activity-goods-form',{title:p.id?'编辑活动专区商品':'添加活动专区商品',p,errs,cats:cats(),tpls:tpls()});
 r.get('/activity-goods',need('marketing'),(req,res)=>{
  const rows=db.all('SELECT id FROM products WHERE activity_only=1 ORDER BY id DESC').map(x=>get(x.id));
  res.page('admin/activity-goods',{title:'活动专区商品',rows,now:U.now()});
 });
 r.get('/activity-goods/new',need('marketing'),(req,res)=>form(res,{name:'',description:'',market_price:'',price:'',stock:'',limit_per_user:1,on:1,ship_from:'',aftersale_text:'',image:'',start_at:local(Date.now()),end_at:local(Date.now()+365*864e5)}));
 r.get('/activity-goods/:id/edit',need('marketing'),(req,res)=>{const p=get(U.int(req.params.id));if(!p)return res.status(404).send('活动专区商品不存在');form(res,p);});
 r.post('/activity-goods/save',need('marketing'),(req,res)=>{
  const b=req.body,id=U.int(b.id),old=id?get(id):null;if(id&&!old)return res.status(404).send('活动专区商品不存在');
  const T=k=>String(b[k]==null?'':b[k]).trim();
  const p={id:old?old.id:'',name:T('name').slice(0,120),description:T('description').slice(0,10000),category_id:U.int(b.category_id),template_id:U.int(b.template_id),market_price:T('market_price'),price:T('price'),stock:T('stock'),limit_per_user:T('limit_per_user')||'1',start_at:T('start_at'),end_at:T('end_at'),on:b.on==='1'?1:0,ship_from:T('ship_from').slice(0,60),aftersale_text:T('aftersale_text').slice(0,300),image:old?old.image:''};
  const up=filesOf(req,'image_files');const iu=T('image_url');if(up.length)p.image=up[0];else if(iu)p.image=iu;
  const e={};
  if(!p.name)e.name='请填写商品名称';else{const ts=J.compliance.titleScope(p.name),sw=J.compliance.scopeWarning([p.name]);if(ts)e.name='商品名称含经营范围外商品「'+ts.kw+'」，不能添加';else if(sw&&sw.kw)e.name='商品名称属于经营范围外品类（'+sw.group+'：「'+sw.kw+'」），不能添加';}
  const c=cats().find(c=>c.id===p.category_id);if(!c)e.category_id='请选择商品分类';else{const sc=J.compliance.scopeWarning([c.parent_name,c.name]);if(sc)e.category_id='经营范围不符，不能添加：'+sc.msg;else if(p.name&&!e.name){const pf=J.compliance.processedFarm([c.parent_name,c.name],p.name);if(pf)e.name='加工食品（'+pf.kw.replace('加工食品:','')+'）需先办食品经营许可，不能上架';}}
  const price=U.round2(Number(p.price));if(p.price===''||!Number.isFinite(price)||price<=0||price>20000)e.price='请填写活动价（大于0且不超过20000元）';
  let mp=null;if(p.market_price!==''){mp=U.round2(Number(p.market_price));if(!Number.isFinite(mp)||mp<=0||mp>20000)e.market_price='划线价格式不正确';else if(!e.price&&mp<=price)e.market_price='划线价须高于活动价，不填则不显示';}
  const stock=Number(p.stock);if(p.stock===''||!Number.isSafeInteger(stock)||stock<0||stock>1000000)e.stock='请填写库存（0至1000000的整数）';
  else if(old&&stock<old.sold)e.stock='库存不能少于已售 '+old.sold+' 件';
  const lim=Number(p.limit_per_user);if(!Number.isSafeInteger(lim)||lim<1||lim>999)e.limit_per_user='每人限购需为1至999的整数';
  const st=dt(p.start_at),en=dt(p.end_at),re=/^\d{4}-\d\d-\d\d \d\d:\d\d:00$/;if(!re.test(st)||!re.test(en))e.end_at='请填写开始和结束时间';else if(en<=st)e.end_at='结束时间必须晚于开始时间';
  if(!db.get('SELECT 1 FROM shipping_templates WHERE id=?',p.template_id))e.template_id='请选择运费模板';
  if(!p.ship_from)e.ship_from='请填写发货方，如「海南韵农科技有限公司 海口发货」';
  if(!p.aftersale_text)e.aftersale_text='请填写售后规则，会显示在商品详情页';
  if(!p.image)e.image='请上传商品图片';else{let safe=/^\/(static|uploads)\//.test(p.image);try{const u=new URL(p.image);safe=u.protocol==='https:'&&!u.username&&!u.password;}catch{}if(!safe)e.image='图片仅支持本站上传或HTTPS地址';}
  const bw=(k,v,lab)=>{if(e[k]||!v)return;const h=B.checkProduct({name:v},[]);if(h.length)e[k]='请先修改敏感或违禁表述：'+B.summarize(h).replace(/\(商品名称\)|（商品名称）|\(标题\)|\(名称\)/g,'')+'（'+lab+'）';};
  bw('name',p.name,'商品名称');bw('ship_from',p.ship_from,'发货方');bw('aftersale_text',p.aftersale_text,'售后规则');bw('description',p.description,'商品详情');
  if(Object.keys(e).length){res.locals.flash={type:'error',msg:'还有 '+Object.keys(e).length+' 项没填好，请按红字提示修改'};return form(res,p,e);}
  let pid=old&&old.id;
  db.transaction(()=>{
   const row={name:p.name,description:p.description,category_id:p.category_id,template_id:p.template_id,price,market_price:mp,stock,status:p.on,images:JSON.stringify([p.image]),ship_from:p.ship_from,aftersale_text:p.aftersale_text};
   const ks=Object.keys(row);
   if(old)db.exec1('UPDATE products SET '+ks.map(k=>k+'=?').join(',')+' WHERE id=? AND activity_only=1',...ks.map(k=>row[k]),pid);
   else{row.activity_only=1;row.spec_names='规格';row.weight=0.5;row.no_reason_return=1;row.created_at=U.now();const k2=Object.keys(row);pid=Number(db.exec1('INSERT INTO products('+k2.join(',')+')VALUES('+k2.map(()=>'?').join(',')+')',...k2.map(k=>row[k])).lastInsertRowid);}
   let sku=db.get('SELECT id FROM skus WHERE product_id=? ORDER BY id LIMIT 1',pid);
   if(sku)db.exec1('UPDATE skus SET price=?,stock=? WHERE id=?',price,stock,sku.id);else sku={id:Number(db.exec1('INSERT INTO skus(product_id,attrs,spec_text,price,stock)VALUES(?,?,?,?,?)',pid,'{"规格":"默认"}','默认',price,stock).lastInsertRowid)};
   if(old&&old.sk_id)db.exec1('UPDATE seckills SET sku_id=?,price=?,stock=?,start_at=?,end_at=?,limit_per_user=?,status=? WHERE id=?',sku.id,price,stock,st,en,lim,p.on,old.sk_id);
   else db.exec1('INSERT INTO seckills(product_id,sku_id,price,stock,sold,start_at,end_at,limit_per_user,status)VALUES(?,?,?,?,0,?,?,?,?)',pid,sku.id,price,stock,st,en,lim,p.on);
   log(req,old?'编辑活动专区商品':'添加活动专区商品','#'+pid+' '+p.name+' ¥'+price);
  })();
  flash(req,'success','活动专区商品已保存'+(p.on?'，已在前台活动专区显示':'（当前下架）'));res.redirect('/admin/activity-goods');
 });
 r.post('/activity-goods/:id/toggle',need('marketing'),(req,res)=>{
  const p=get(U.int(req.params.id));if(!p)return res.status(404).send('活动专区商品不存在');const on=p.on?0:1;
  db.transaction(()=>{db.exec1('UPDATE products SET status=? WHERE id=?',on,p.id);if(p.sk_id)db.exec1('UPDATE seckills SET status=? WHERE id=?',on,p.sk_id);})();
  log(req,on?'上架活动专区商品':'下架活动专区商品','#'+p.id);flash(req,'success',on?'已上架到活动专区':'已下架，前台不再显示');res.redirect('/admin/activity-goods');
 });
 r.post('/activity-goods/:id/delete',need('marketing'),(req,res)=>{
  const p=get(U.int(req.params.id));if(!p)return res.status(404).send('活动专区商品不存在');
  if(db.get('SELECT 1 FROM order_items WHERE product_id=?',p.id)){flash(req,'error','已有订单的商品不能删除，请下架');return res.redirect('/admin/activity-goods');}
  db.transaction(()=>{for(const t of['seckills','skus','favorites','history','cart'])t==='cart'?db.exec1('DELETE FROM cart WHERE sku_id NOT IN (SELECT id FROM skus)'):db.exec1(`DELETE FROM ${t} WHERE product_id=?`,p.id);db.exec1('DELETE FROM products WHERE id=? AND activity_only=1',p.id);})();
  log(req,'删除活动专区商品','#'+p.id);flash(req,'success','已删除');res.redirect('/admin/activity-goods');
 });
};
