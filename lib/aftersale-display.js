const db = require('./db');
module.exports = function(a){
 let sp={};try{sp=JSON.parse(a.supplier_status||'{}')||{}}catch{}
 const addresses=(Array.isArray(sp.afsAddressList)?sp.afsAddressList:[]).map(x=>[x.afterServiceReceiver,x.afterServicePhone,x.afterServiceAddress].filter(Boolean).join(' ')).filter(Boolean);
 const events=db.all('SELECT status,detail,created_at FROM aftersale_events WHERE aftersale_id=? ORDER BY id',a.id);
 if(events.length && events[0].detail!=='售后申请已创建') events.unshift({status:null,detail:'售后申请已创建',created_at:a.created_at});
 if(!events.length){events.push({status:null,detail:'售后申请已创建',created_at:a.created_at});if(a.updated_at&&a.updated_at!==a.created_at)events.push({status:a.status,detail:'当前处理状态(历史明细未记录)',created_at:a.updated_at});}
 return {events,addresses:addresses.length?addresses:(a.return_address?[a.return_address]:[]),shippingNote:a.return_shipping_note||'运费承担方式待客服按商品售后规则核实，请确认后再寄回。'};
};
