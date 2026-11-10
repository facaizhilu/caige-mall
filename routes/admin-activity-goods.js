// 活动专区:后台直接上传自定义商品+活动价(自动建商品/规格和活动场次)
const db=require('../lib/db'),U=require('../lib/util'),J=require('../lib/suppliers/jdvop');
module.exports=(r,{need,flash,log,filesOf})=>{
 const cats=()=>db.all('SELECT c.*,p.name parent_name FROM categories c LEFT JOIN categories p ON p.id=c.parent_id WHERE c.parent_id>0 AND c.status=1 ORDER BY c.sort,c.id');
 const dt=s=>s?String(s).replace('T',' ').slice(0,16)+':00':'';
 const def=()=>{const n=new Date(Date.now()+8*3600e3),e=new Date(n.getTime()+30*864e5),f=d=>d.toISOString().slice(0,16);return{start_at:f(n),end_at:f(e)};};
 const form=(res,p)=>res.page('admin/activity-goods-form',{title:'上传自定义活动商品',p,cats:cats(),tpls:db.all('SELECT * FROM shipping_templates ORDER BY id')});
 r.get('/activity-goods/new',need('marketing'),(req,res)=>form(res,{name:'',description:'',orig:'',price:'',stock:100,limit_per_user:1,status:1,...def()}));
 r.post('/activity-goods/save',need('marketing'),(req,res)=>{
  const b=req.body,p={name:String(b.name||'').trim().slice(0,120),description:String(b.description||'').trim().slice(0,10000),category_id:U.int(b.category_id),template_id:U.int(b.template_id),orig:U.round2(Number(b.orig)),price:U.round2(Number(b.price)),stock:Number(b.stock),limit_per_user:Number(b.limit_per_user),start_at:String(b.start_at||''),end_at:String(b.end_at||''),status:b.status==='1'?1:0};
  const fail=m=>{res.locals.flash={type:'error',msg:m};form(res,p);};
  if(!p.name)return fail('请填写商品名称');
  const c=cats().find(c=>c.id===p.category_id);if(!c)return fail('请选择有效的二级商品分类');
  const scope=J.compliance.scopeWarning([c.parent_name,c.name]);if(scope)return fail('经营范围不符，不能添加该类商品：'+scope.msg);
  if(J.compliance.titleScope(p.name))return fail('商品名称含经营范围外商品，请核实分类与商品');
  if(!Number.isFinite(p.orig)||p.orig<=0||p.orig>20000)return fail('原价必须大于0且不超过20000元');
  if(!Number.isFinite(p.price)||p.price<=0||p.price>=p.orig)return fail('活动价必须大于0且低于原价 ¥'+p.orig);
  if(!Number.isSafeInteger(p.stock)||p.stock<1||p.stock>1000000)return fail('活动库存需为1至1000000的整数');
  if(!Number.isSafeInteger(p.limit_per_user)||p.limit_per_user<1||p.limit_per_user>999)return fail('每人限购需为1至999的整数');
  const st=dt(p.start_at),en=dt(p.end_at);if(!/^\d{4}-\d\d-\d\d \d\d:\d\d:00$/.test(st)||!/^\d{4}-\d\d-\d\d \d\d:\d\d:00$/.test(en))return fail('请填写开始和结束时间');if(en<=st)return fail('结束时间必须晚于开始时间');
  if(!db.get('SELECT 1 FROM shipping_templates WHERE id=?',p.template_id))return fail('请选择有效运费模板');
  const hits=require('../lib/banned').checkProduct({name:p.name,description:p.description},[]);if(hits.length)return fail('请先修改敏感或违禁表述：'+require('../lib/banned').summarize(hits));
  let image=String(b.image_url||'').trim();const up=filesOf(req,'image_files');if(up.length)image=up[0];
  if(!image)return fail('请上传商品图片');
  {let safe=/^\/(static|uploads)\//.test(image);try{const u=new URL(image);safe=u.protocol==='https:'&&!u.username&&!u.password;}catch{}if(!safe)return fail('图片仅支持本站上传文件或HTTPS地址');}
  let pid;
  db.transaction(()=>{
   pid=Number(db.exec1('INSERT INTO products(name,description,category_id,template_id,price,market_price,stock,status,images,spec_names,weight,no_reason_return,created_at)VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',p.name,p.description,p.category_id,p.template_id,p.orig,p.orig,p.stock,1,JSON.stringify([image]),'规格',0.5,1,U.now()).lastInsertRowid);
   const sid=Number(db.exec1('INSERT INTO skus(product_id,attrs,spec_text,price,stock)VALUES(?,?,?,?,?)',pid,'{"规格":"默认"}','默认',p.orig,p.stock).lastInsertRowid);
   db.exec1('INSERT INTO seckills(product_id,sku_id,price,stock,sold,start_at,end_at,limit_per_user,status)VALUES(?,?,?,?,0,?,?,?,?)',pid,sid,p.price,p.stock,st,en,p.limit_per_user,p.status);
   log(req,'上传自定义活动商品','#'+pid+' '+p.name+' ¥'+p.price);
  })();
  flash(req,'success','活动商品已上传，已加入活动专区'+(p.status?'':'（当前停用）'));res.redirect('/admin/seckills');
 });
};
