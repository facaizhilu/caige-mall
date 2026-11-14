'use strict';
// Always starts a separate mock-only server and creates a new private temporary DB.
const fs=require('fs'),os=require('os'),path=require('path'),{spawn}=require('child_process'),net=require('net'),crypto=require('crypto');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'caige-ac-'));fs.writeFileSync(path.join(dir,'.ac-test-only'),'synthetic fixture database',{flag:'wx',mode:0o600});
 const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
 const env={...process.env,NODE_ENV:'test',DATA_DIR:dir,DEMO_MODE:'1',JDVOP_MODE:'mock',JDVOP_RELAY_URL:'',AC_TEST_FRESH:'1',SESSION_SECRET:crypto.randomBytes(32).toString('hex'),PORT:String(port)},cwd=path.resolve(__dirname,'..');
 const serverLog=fs.openSync(path.join(dir,'server.log'),'w'),server=spawn(process.execPath,['server.js'],{cwd,env,stdio:['ignore',serverLog,serverLog]});let child;
 const stop=()=>{if(child&&!child.killed)child.kill('SIGTERM');if(!server.killed)server.kill('SIGTERM');};process.on('SIGTERM',()=>{stop();process.exit(143)});process.on('SIGINT',()=>{stop();process.exit(130)});
 try{
  let ready=false;for(let i=0;i<100;i++){try{const r=await fetch('http://127.0.0.1:'+port+'/login');if(r.status===200){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,200));}if(!ready)throw Error('Mock server did not start; inspect '+path.join(dir,'server.log'));
  child=spawn(process.execPath,['test/ac.js','http://127.0.0.1:'+port],{cwd,env,stdio:'inherit'});const code=await new Promise(resolve=>child.on('exit',resolve));stop();console.log('Isolated artifacts: '+dir);process.exit(code===0?0:1);
 }catch(e){stop();console.error(e);process.exit(1)}
})().catch(e=>{console.error(e);process.exit(1)});
