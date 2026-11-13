// 「关于韵农甄选」后台编辑:标题、封面图、简介、图文段落(文字+图片),保存即发布到前台 /about
const db=require('../lib/db'),U=require('../lib/util'),B=require('../lib/banned'),svc=require('../lib/svc');
const MAX=8;
const safeImg=v=>{if(!v)return true;if(/^\/(static|uploads)\/[\w\-./]+$/.test(v)&&!v.includes('..'))return true;try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}};
const strip=h=>String(h||'').replace(/<br\s*\/?>/gi,'\n').replace(/<\/p>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').replace(/\n{2,}/g,'\n').trim();
const aboutArticle=()=>db.get("SELECT * FROM articles WHERE category='about' ORDER BY status DESC, sort, id LIMIT 1");
function load(){
 let d=null;try{d=JSON.parse(svc.S('about_page')||'null');}catch{}
 if(d&&d.title)return{...d,blocks:(d.blocks||[]).slice(0,MAX)};
 const a=aboutArticle();
 return{title:(a&&a.title)||'关于韵农甄选',cover:'',intro:'',blocks:a&&a.content?[{text:strip(a.content),image:''}]:[],updated_at:''};
}
const paras=t=>String(t||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean).map(s=>'<p>'+U.esc(s)+'</p>').join('');
const toHtml=d=>(d.intro?paras(d.intro):'')+d.blocks.map(b=>(b.image?'<p><img src="'+U.esc(b.image)+'" alt="" style="max-width:100%"></p>':'')+paras(b.text)).join('');
module.exports=(r,{need,flash,log,filesOf})=>{
 r.get('/about',need('content'),(req,res)=>res.page('admin/about',{title:'关于韵农甄选',d:load(),errs:{},max:MAX}));
 r.post('/about',need('content'),(req,res)=>{
  const b=req.body,errs={},old=load();
  const img=(file,url,del)=>{const up=filesOf(req,file)[0];if(up)return up;if(b[del])return'';return String(b[url]||'').trim();};
  const d={title:String(b.title||'').trim(),cover:img('cover_file','cover_url','cover_del'),intro:String(b.intro||'').trim(),blocks:[]};
  for(let i=0;i<MAX;i++){const text=String(b['text_'+i]||'').trim(),image=img('img_file_'+i,'img_url_'+i,'img_del_'+i);if(text||image)d.blocks.push({text,image});}
  if(!d.title)errs.title='请填写标题';else if(d.title.length>30)errs.title='标题最多 30 个字';
  if(d.intro.length>300)errs.intro='简介最多 300 个字';
  if(!d.blocks.length)errs.blocks='至少填写一段文字或上传一张图片';
  d.blocks.forEach((x,i)=>{if(x.text.length>2000)errs['text_'+i]='每段文字最多 2000 个字';});
  if(!safeImg(d.cover))errs.cover='图片仅支持本站上传或 HTTPS 地址';
  d.blocks.forEach((x,i)=>{if(!safeImg(x.image))errs['text_'+i]='图片仅支持本站上传或 HTTPS 地址';});
  const fields={title:d.title,intro:d.intro};d.blocks.forEach((x,i)=>fields['text_'+i]=x.text);
  const lab=k=>k==='title'?'标题':k==='intro'?'简介':'第 '+(+k.slice(5)+1)+' 段文字';
  for(const h of B.check(fields)){if(!errs[h.field])errs[h.field]=lab(h.field)+'含违禁词「'+h.word+'」，请修改';}
  if(Object.keys(errs).length){flash(req,'error','保存失败，请按红字提示修改');return res.page('admin/about',{title:'关于韵农甄选',d,errs,max:MAX});}
  d.updated_at=U.now();
  svc.setSetting('about_page',JSON.stringify(d));
  const a=aboutArticle(),html=toHtml(d);
  if(a)db.exec1('UPDATE articles SET title=?,content=?,status=1 WHERE id=?',d.title,html,a.id);
  else db.exec1("INSERT INTO articles(category,topic,title,content,status,sort,created_at) VALUES('about','关于',?,?,1,0,?)",d.title,html,U.now());
  log(req,'编辑关于韵农甄选',d.title+'，'+d.blocks.length+' 段'+(old.title!==d.title?'（原标题 '+old.title+'）':''));
  flash(req,'success','已保存并发布，前台「关于韵农甄选」已更新');res.redirect('/admin/about');
 });
};
module.exports.load=load;module.exports.safeImg=safeImg;
