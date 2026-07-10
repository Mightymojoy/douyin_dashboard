
// ============================================================
//  1. SAMPLE DATA
// ============================================================
const SHOP_NAMES = {mdnjg:'摩登新贵女',qszsk:'轻熟质享客',ydswj:'云端商务家'};
const SHOP_COLORS = {mdnjg:'#c9a962',qszsk:'#e07b4a',ydswj:'#4a9e8e'};

function seedDateStr(d){return d.toISOString().slice(0,10)}
function addDays(d,n){let r=new Date(d);r.setDate(r.getDate()+n);return r}

// Load real data from dashboard_data.js
const D = window.DASHBOARD_DATA || {};
const SHOP_DATA = {};
const SESSION_DATA = [];
const QC_DATA = [];
Object.keys(D).forEach(sid=>{
  SHOP_DATA[sid] = (D[sid].shop||[]).map(d=>({...d}));
  (D[sid].sessions||[]).forEach(s=>{SESSION_DATA.push({...s,shop:sid,anchor:''})});
  (D[sid].qianchuan||[]).forEach(q=>{QC_DATA.push({...q,shop:sid})});
});

const NOW = '2026-07-07 10:00';
document.getElementById('updateTime').textContent = '数据更新于 ' + NOW;

// ============================================================
//  2. UTILITY
// ============================================================
function numFmt(n){return n.toLocaleString('zh-CN')}
function moneyFmt(n){return '¥'+(n>=10000?(n/10000).toFixed(1)+'w':numFmt(n))}
function pctFmt(n){return (n||0).toFixed(2)+'%'}

function fmtChange(val){
  if(!val || val===0 || val==='0%') return '<span class="pct-change pct-yellow">0%</span>';
  const up = val>0;
  const cls = up?'pct-green':'pct-red';
  const sym = up?'↑':'↓';
  return `<span class="pct-change ${cls}">${sym} ${Math.abs(val).toFixed(2)}%</span>`;
}

function calcChange(cur,prev){
  if(!prev||prev===0) return {val:0,label:'-'};
  const v = (cur - prev)/prev*100;
  return {val:v,label:v>0?'up':v<0?'down':'neutral',text:(v>0?'+':'')+v.toFixed(2)+'%'};
}

function aggGran(data,dateKey,gran){
  if(gran==='day') return data;
  const map={};
  data.forEach(d=>{
    const dt = new Date(d[dateKey]);
    let key;
    if(gran==='week'){
      const wStart = new Date(dt); wStart.setDate(wStart.getDate()-wStart.getDay());
      key = seedDateStr(wStart)+'_week';
    } else {
      key = dt.getFullYear()+'-'+('0'+(dt.getMonth()+1)).slice(-2)+'_month';
    }
    if(!map[key]){map[key]={dates:[],count:0,gmv:0,gsv:0,refundPayTime:0,refundAmt:0,orderBuyers:0,refundRate:0,feeRatio:0,feeRatioW:0,gsvW:0,subsidy:0,coupon:0,avgPrice:0};}
    const a = map[key]; a.dates.push(d[dateKey]); a.count++; a.gmv+=d.gmv; a.gsv+=d.gsv; a.refundPayTime+=d.refundPayTime||0; a.refundAmt+=d.refundAmt||0; a.orderBuyers+=d.orderBuyers||0;
    a.subsidy+=d.subsidy||0; a.coupon+=d.coupon||0; a.feeRatioW+=(d.feeRatio||0)*d.gsv; a.gsvW+=d.gsv;
  });
  return Object.keys(map).map(k=>{
    const a=map[k];
    return {
      _aggLabel:gran==='week'?'W'+(k.split('_')[0].slice(5)):k.split('_')[0],
      date:k.split('_')[0],gmv:a.gmv,gsv:a.gsv,orderBuyers:a.orderBuyers,
      refundRate:+(a.gmv?a.refundPayTime/a.gmv:0).toFixed(4),
      feeRatio:+(a.gsvW?a.feeRatioW/a.gsvW:0).toFixed(4),
      subsidy:a.subsidy,coupon:a.coupon,avgPrice:a.orderBuyers?Math.round(a.gmv/a.orderBuyers):0
    };
  });
}

function filterByDate(data,start,end,dateKey='date'){
  if(!data||!data.length) return [];
  return data.filter(d=>d[dateKey]>=start&&d[dateKey]<=end);
}

// ============================================================
//  3. STATE
// ============================================================
const state = {
  activeTab:'overview',activeShop:'mdnjg',gran:'day',compareOn:false,
  start:'2026-06-01',end:NOW.slice(0,10),cStart:'2026-05-01',cEnd:'2026-05-31',
  shopFilter:'all',showAvgLine:true,showTop3:true,showTable:true,
  shopPage:1,ssPage:1,qcPage:1,pageSize:15,
  shopKpiSelected:['gmv','gsv','subsidy','orderBuyers','refundRate','avgPrice','feeRatio','yoy'],
  ssKpiSelected:['days','gmv','gsv','avgGmv','durHour','gpm','uv'],
  qcKpiSelected:['totalSpend','promoGmv','promoRoi','avgPromoRoi','nonGrantSpend','nonGrantFeeRatio']
};
// charts
let charts={};

// ============================================================
//  3.1 COMMON CHART HELPERS (对比 / 平均线 / TOP3 高亮)
// ============================================================

// 按索引位置计算同比变化率：((当期 - 对比期) / 对比期 * 100)
function getPeriodChange(mainData, compareData, key, isPct){
  if(!compareData || !compareData.length) return mainData.map(()=>null);
  return mainData.map((d,i)=>{
    const c = compareData[i];
    const cur = isPct ? (d[key]||0)*100 : (d[key]||0);
    const prev = c ? (isPct ? (c[key]||0)*100 : (c[key]||0)) : 0;
    return prev ? +((cur-prev)/prev*100).toFixed(2) : null;
  });
}

// 返回数组中 top3 位置的布尔数组
function getTop3Indices(arr){
  const idxs = arr.map((v,i)=>({v,i})).filter(x=>x.v>0).sort((a,b)=>b.v-a.v).slice(0,3).map(x=>x.i);
  const set = new Set(idxs);
  return arr.map((_,i)=>set.has(i));
}

// Chart.js 自定义插件：绘制平均线
const avgLinePlugin = {
  id:'avgLinePlugin',
  afterDraw(chart, args, options){
    if(!options.enabled || options.value===null || options.value===undefined || isNaN(options.value)) return;
    const {ctx, chartArea, scales} = chart;
    const y = scales[options.scaleID||'y'];
    if(!y) return;
    const yPos = y.getPixelForValue(options.value);
    if(yPos < chartArea.top || yPos > chartArea.bottom) return;
    ctx.save();
    ctx.beginPath();
    ctx.strokeStyle = options.color || 'rgba(37,99,235,0.5)';
    ctx.lineWidth = options.lineWidth || 1;
    ctx.setLineDash(options.dash || [5,5]);
    ctx.moveTo(chartArea.left, yPos);
    ctx.lineTo(chartArea.right, yPos);
    ctx.stroke();
    if(options.label){
      ctx.fillStyle = options.color || 'rgba(37,99,235,0.7)';
      ctx.font = options.font || '10px Inter';
      ctx.textAlign = 'left';
      ctx.fillText(options.label, chartArea.left + 4, yPos - 6);
    }
    ctx.restore();
  }
};
if(typeof Chart!=='undefined') Chart.register(avgLinePlugin);

// 获取对比周期数据（供四个 tab 主趋势图使用）
function getCompareData(type, shopKey){
  const {cStart, cEnd, gran, shopFilter} = state;
  if(type==='shop'){
    return aggregateShopData(filterByDate(SHOP_DATA[shopKey], cStart, cEnd), gran);
  }
  if(type==='session'){
    let data = SESSION_DATA;
    if(shopFilter!=='all') data = data.filter(d=>d.shop===shopFilter);
    return aggregateSessionData(filterByDate(data, cStart, cEnd, 'date'), gran);
  }
  if(type==='qianchuan'){
    let data = QC_DATA;
    if(shopFilter!=='all') data = data.filter(d=>d.shop===shopFilter);
    return aggregateQcData(filterByDate(data, cStart, cEnd, 'date'), gran);
  }
  return [];
}

// 将对比周期数据按主周期日期对齐（返回数组，缺失补 null）
function alignByDate(mainLabels, compareData, key){
  const map = {};
  compareData.forEach(d=>{ map[d.date] = (map[d.date]||0) + (d[key]||0); });
  return mainLabels.map(date=>map[date]||null);
}

// 渲染对比周期 KPI 行（各 tab 调用）
function calcKpiChange(mainVal, compareVal){
  if(compareVal===undefined || compareVal===null || compareVal===0 || isNaN(compareVal)) return null;
  const pct = (mainVal - compareVal) / compareVal * 100;
  if(!isFinite(pct)) return null;
  const cls = pct > 0 ? 'pct-green' : 'pct-red';
  const arr = pct > 0 ? '▲' : '▼';
  return { pct, cls, arr, text: `${arr} ${Math.abs(pct).toFixed(2)}%` };
}

function renderCompareKpiRow(elId, mainData, compareData, items){
  const el = document.getElementById(elId);
  if(!state.compareOn || !compareData || !compareData.length){
    el.style.display='none'; return;
  }
  el.style.display='grid';
  let html = '';
  items.forEach(item=>{
    const compareVal = item.calc(compareData);
    const mainVal = item.calc(mainData);
    const delta = item.skipDelta ? null : calcKpiChange(mainVal, compareVal);
    const deltaHtml = delta ? `<div class="kpi-delta ${delta.cls}">${delta.text}</div>` : '';
    html += `<div class="kpi-card"><div class="kpi-icon"><i data-lucide="${item.icon}"></i></div>
      <div class="kpi-label">${item.label}</div><div class="kpi-value">${item.fmt(compareVal)}</div>${deltaHtml}</div>`;
  });
  el.innerHTML = html;
  setTimeout(()=>{try{lucide.createIcons()}catch(e){}},50);
}

// ============================================================
//  3.5 KPI META
// ============================================================
const KPI_GROUPS = [
  {name:'核心指标',items:[
    {key:'gmv',label:'自营GMV',icon:'dollar-sign',calc:d=>d.reduce((s,r)=>s+r.gmv,0),fmt:v=>moneyFmt(v)},
    {key:'gsv',label:'自营GSV',icon:'bar-chart-3',calc:d=>d.reduce((s,r)=>s+r.gsv,0),fmt:v=>moneyFmt(v)},
    {key:'avgDailyGsv',label:'日均自营GSV',icon:'bar-chart-3',calc:d=>{const l=d.length;return l?d.reduce((s,r)=>s+r.gsv,0)/l:0},fmt:v=>moneyFmt(Math.round(v))},
    {key:'payGsv',label:'用户支付GSV',icon:'credit-card',calc:d=>d.reduce((s,r)=>s+r.payGsv,0),fmt:v=>moneyFmt(v)},
    {key:'refundAmt',label:'自营退款(退款时间)',icon:'rotate-ccw',calc:d=>d.reduce((s,r)=>s+r.refundAmt,0),fmt:v=>moneyFmt(v)},
    {key:'refundPayTime',label:'自营退款(支付时间)',icon:'rotate-ccw',calc:d=>d.reduce((s,r)=>s+r.refundPayTime,0),fmt:v=>moneyFmt(v)},
    {key:'gsvTarget',label:'GSV目标',icon:'target',calc:d=>d.reduce((s,r)=>s+r.gsvTarget,0),fmt:v=>moneyFmt(v)},
    {key:'achieveRate',label:'达成率',icon:'milestone',calc:d=>{const g=d.reduce((s,r)=>s+r.gsv,0);const t=d.reduce((s,r)=>s+r.gsvTarget,0);return t?g/t*100:0},fmt:v=>v.toFixed(2)+'%'},
    {key:'orderBuyers',label:'成交人数',icon:'users',calc:d=>d.reduce((s,r)=>s+(r.orderBuyers||0),0),fmt:v=>numFmt(v)},
    {key:'clickUsers',label:'商品点击人数',icon:'mouse-pointer',calc:d=>d.reduce((s,r)=>s+(r.clickUsers||0),0),fmt:v=>numFmt(v)},
    {key:'exposeUsers',label:'商品曝光人数',icon:'eye',calc:d=>d.reduce((s,r)=>s+(r.exposeUsers||0),0),fmt:v=>numFmt(v)}
  ]},
  {name:'同比指标',items:[
    {key:'prevYearGsv',label:'25年同期GSV',icon:'calendar',calc:d=>d.reduce((s,r)=>s+(r.prevYearGsv||0),0),fmt:v=>moneyFmt(v)},
    {key:'yoy',label:'同比变化',icon:'trending-up',calc:d=>{const g=d.reduce((s,r)=>s+r.gsv,0);const p=d.reduce((s,r)=>s+(r.prevYearGsv||0),0);return p?(g-p)/p*100:0},fmt:v=>{const cls=v>0?'pct-green':'pct-red';const arr=v>0?'▲':'▼';return `<span class="${cls}">${arr} ${v.toFixed(2)}%</span>`}}
  ]},
  {name:'商城维度',items:[
    {key:'liveGsv',label:'直播GSV',icon:'radio',calc:d=>d.reduce((s,r)=>s+r.liveGsv,0),fmt:v=>moneyFmt(v)},
    {key:'mallGsv',label:'商城GSV',icon:'shopping-cart',calc:d=>d.reduce((s,r)=>s+r.mallGsv,0),fmt:v=>moneyFmt(v)},
    {key:'avgDailyMallGsv',label:'日均商城GSV',icon:'shopping-cart',calc:d=>{const l=d.length;return l?d.reduce((s,r)=>s+r.mallGsv,0)/l:0},fmt:v=>moneyFmt(Math.round(v))},
    {key:'mallBeforeRatio',label:'商城退前占比',icon:'percent',calc:d=>{const m=d.reduce((s,r)=>s+r.gmv,0);return m?d.reduce((s,r)=>s+(r.mallBeforeRatio||0)*r.gmv,0)/m*100:0},fmt:v=>v.toFixed(2)+'%'},
    {key:'mallAfterRatio',label:'商城退后占比',icon:'percent',calc:d=>{const g=d.reduce((s,r)=>s+r.gsv,0);return g?d.reduce((s,r)=>s+(r.mallAfterRatio||0)*r.gsv,0)/g*100:0},fmt:v=>v.toFixed(2)+'%'},
    {key:'mallRefund',label:'商城退款',icon:'rotate-ccw',calc:d=>d.reduce((s,r)=>s+(r.mallRefund||0),0),fmt:v=>moneyFmt(v)}
  ]},
  {name:'退款率',items:[
    {key:'refundRate',label:'自营退款率',icon:'percent',calc:d=>{const g=d.reduce((s,r)=>s+r.gmv,0);const p=d.reduce((s,r)=>s+(r.refundPayTime||0),0);return g?p/g*100:0},fmt:v=>v.toFixed(2)+'%'},
    {key:'refundRateTime',label:'自营退款率(退款时间)',icon:'percent',calc:d=>{const g=d.reduce((s,r)=>s+r.gmv,0);const a=d.reduce((s,r)=>s+(r.refundAmt||0),0);return g?a/g*100:0},fmt:v=>v.toFixed(2)+'%'},
    {key:'liveRefundRate',label:'直播间退款率',icon:'percent',calc:d=>{const a=d.reduce((s,r)=>s+(r.liveAmt||0),0);return a?d.reduce((s,r)=>s+(r.liveRefund||0),0)/a*100:0},fmt:v=>v.toFixed(2)+'%'},
    {key:'mallRefundRate',label:'商城退款率',icon:'percent',calc:d=>{const b=d.reduce((s,r)=>s+(r.cardOrder||0)+(r.otherRe||0)+(r.shortVideo||0),0);return b?d.reduce((s,r)=>s+(r.mallRefund||0),0)/b*100:0},fmt:v=>v.toFixed(2)+'%'}
  ]},
  {name:'转化效率',items:[
    {key:'avgPrice',label:'客单价',icon:'tag',calc:d=>{const g=d.reduce((s,r)=>s+r.gmv,0);const b=d.reduce((s,r)=>s+(r.orderBuyers||0),0);return b?g/b:0},fmt:v=>'¥'+numFmt(Math.round(v))},
    {key:'expClickRate',label:'曝光点击率',icon:'eye',calc:d=>{const e=d.reduce((s,r)=>s+(r.exposeUsers||0),0);return e?d.reduce((s,r)=>s+(r.clickUsers||0),0)/e*100:0},fmt:v=>v.toFixed(2)+'%'},
    {key:'clickConvRate',label:'点击转化率',icon:'mouse-pointer',calc:d=>{const c=d.reduce((s,r)=>s+(r.clickUsers||0),0);return c?d.reduce((s,r)=>s+(r.orderBuyers||0),0)/c*100:0},fmt:v=>v.toFixed(2)+'%'},
    {key:'expConvRate',label:'曝光转化率',icon:'eye',calc:d=>{const e=d.reduce((s,r)=>s+(r.exposeUsers||0),0);return e?d.reduce((s,r)=>s+(r.orderBuyers||0),0)/e*100:0},fmt:v=>v.toFixed(2)+'%'}
  ]},
  {name:'渠道拆解',items:[
    {key:'cardOrder',label:'商品卡成交',icon:'shopping-bag',calc:d=>d.reduce((s,r)=>s+(r.cardOrder||0),0),fmt:v=>moneyFmt(v)},
    {key:'otherRe',label:'其他',icon:'ellipsis',calc:d=>d.reduce((s,r)=>s+(r.otherRe||0),0),fmt:v=>moneyFmt(v)},
    {key:'shortVideo',label:'短视频及图文',icon:'video',calc:d=>d.reduce((s,r)=>s+(r.shortVideo||0),0),fmt:v=>moneyFmt(v)},
    {key:'liveAmt',label:'直播间成交金额',icon:'radio',calc:d=>d.reduce((s,r)=>s+(r.liveAmt||0),0),fmt:v=>moneyFmt(v)},
    {key:'liveRefund',label:'直播间退款',icon:'rotate-ccw',calc:d=>d.reduce((s,r)=>s+(r.liveRefund||0),0),fmt:v=>moneyFmt(v)}
  ]},
  {name:'费用',items:[
    {key:'subsidy',label:'平台补贴',icon:'gift',calc:d=>d.reduce((s,r)=>s+r.subsidy,0),fmt:v=>moneyFmt(v)},
    {key:'coupon',label:'千川优惠券',icon:'ticket',calc:d=>d.reduce((s,r)=>s+r.coupon,0),fmt:v=>moneyFmt(v)},
    {key:'feeRatio',label:'店费比',icon:'trending-up',calc:d=>{const g=d.reduce((s,r)=>s+(r.gsv||0),0);return g?d.reduce((s,r)=>s+(r.feeRatio||0)*r.gsv,0)/g*100:0},fmt:v=>v.toFixed(2)+'%'}
  ]}
];
// map key -> meta for quick lookup
const KPI_META = {};
KPI_GROUPS.forEach(g=>g.items.forEach(i=>{KPI_META[i.key]=i}));

// ========== Session KPI Meta ==========
const SS_KPI_GROUPS = [
  {name:'核心指标',items:[
    {key:'days',label:'直播天数',icon:'radio',calc:d=>d.length,fmt:v=>numFmt(v)},
    {key:'gmv',label:'总GMV',icon:'dollar-sign',calc:d=>d.reduce((s,r)=>s+r.gmv,0),fmt:v=>moneyFmt(v)},
    {key:'gsv',label:'直播GSV',icon:'bar-chart-3',calc:d=>d.reduce((s,r)=>s+r.gsv,0),fmt:v=>moneyFmt(v)},
    {key:'avgDailyGsv',label:'日均直播GSV',icon:'bar-chart-3',calc:d=>{const l=d.length;return l?d.reduce((s,r)=>s+r.gsv,0)/l:0},fmt:v=>moneyFmt(Math.round(v))},
    {key:'avgGmv',label:'场均GMV',icon:'dollar-sign',calc:d=>{const l=d.length;return l?d.reduce((s,r)=>s+r.gmv,0)/l:0},fmt:v=>moneyFmt(Math.round(v))},
    {key:'durHour',label:'直播时长(h)',icon:'clock',calc:d=>d.reduce((s,r)=>s+(r.durHour||0),0),fmt:v=>numFmt(Math.round(v))}
  ]},
  {name:'时长维度',items:[
    {key:'durMin',label:'直播时长(M)',icon:'clock',calc:d=>d.reduce((s,r)=>s+(r.durMin||0),0),fmt:v=>numFmt(Math.round(v))}
  ]},
  {name:'效率指标',items:[
    {key:'gpm',label:'GPM',icon:'trending-up',calc:d=>{const uv=d.reduce((s,r)=>s+(r.uv||0),0);return uv?d.reduce((s,r)=>s+(r.gmv||0),0)/uv*1000:0},fmt:v=>numFmt(Math.round(v))},
    {key:'gsvPerHour',label:'时均GSV',icon:'bar-chart-3',calc:d=>{const h=d.reduce((s,r)=>s+(r.durHour||0),0);return h?d.reduce((s,r)=>s+(r.gsv||0),0)/h:0},fmt:v=>moneyFmt(Math.round(v))},
    {key:'uvPerHour',label:'时均UV',icon:'users',calc:d=>{const h=d.reduce((s,r)=>s+(r.durHour||0),0);return h?d.reduce((s,r)=>s+(r.uv||0),0)/h:0},fmt:v=>numFmt(Math.round(v))}
  ]},
  {name:'客流指标',items:[
    {key:'uv',label:'UV(场观)',icon:'eye',calc:d=>d.reduce((s,r)=>s+(r.uv||0),0),fmt:v=>numFmt(v)},
    {key:'liveExpose',label:'直播曝光人数',icon:'eye',calc:d=>d.reduce((s,r)=>s+(r.liveExpose||0),0),fmt:v=>numFmt(v)},
    {key:'prodExpose',label:'商品曝光人数',icon:'eye',calc:d=>d.reduce((s,r)=>s+(r.prodExpose||0),0),fmt:v=>numFmt(v)},
    {key:'prodClick',label:'商品点击人数',icon:'mouse-pointer',calc:d=>d.reduce((s,r)=>s+(r.prodClick||0),0),fmt:v=>numFmt(v)},
    {key:'dealBuyers',label:'成交人数',icon:'users',calc:d=>d.reduce((s,r)=>s+(r.dealBuyers||0),0),fmt:v=>numFmt(v)},
    {key:'interactUsers',label:'直播互动人数',icon:'message-circle',calc:d=>d.reduce((s,r)=>s+(r.interactUsers||0),0),fmt:v=>numFmt(v)},
    {key:'newFans',label:'新增粉丝',icon:'user-plus',calc:d=>d.reduce((s,r)=>s+(r.newFans||0),0),fmt:v=>numFmt(v)},
    {key:'avgViewSec',label:'人均观看(s)',icon:'clock',calc:d=>{const uv=d.reduce((s,r)=>s+(r.uv||0),0);return uv?d.reduce((s,r)=>s+(r.avgViewSec||0)*(r.uv||0),0)/uv:0},fmt:v=>numFmt(Math.round(v))}
  ]},
  {name:'转化率',items:[
    {key:'expViewRate',label:'曝光-观看率',icon:'eye',calc:d=>{const le=d.reduce((s,r)=>s+(r.liveExpose||0),0);return le?d.reduce((s,r)=>s+(r.uv||0),0)/le*100:0},fmt:v=>v.toFixed(2)+'%'},
    {key:'viewProdExposeRate',label:'观看-商品曝光率',icon:'eye',calc:d=>{const uv=d.reduce((s,r)=>s+(r.uv||0),0);return uv?d.reduce((s,r)=>s+(r.prodExpose||0),0)/uv*100:0},fmt:v=>v.toFixed(2)+'%'},
    {key:'prodExpClickRate',label:'商品曝光点击率',icon:'mouse-pointer',calc:d=>{const pe=d.reduce((s,r)=>s+(r.prodExpose||0),0);return pe?d.reduce((s,r)=>s+(r.prodClick||0),0)/pe*100:0},fmt:v=>v.toFixed(2)+'%'},
    {key:'prodClickDealRate',label:'商品点击成交率',icon:'shopping-cart',calc:d=>{const pc=d.reduce((s,r)=>s+(r.prodClick||0),0);return pc?d.reduce((s,r)=>s+(r.dealBuyers||0),0)/pc*100:0},fmt:v=>v.toFixed(2)+'%'},
    {key:'liveExpDealRate',label:'曝光-成交率',icon:'shopping-cart',calc:d=>{const le=d.reduce((s,r)=>s+(r.liveExpose||0),0);return le?d.reduce((s,r)=>s+(r.dealBuyers||0),0)/le*100:0},fmt:v=>v.toFixed(2)+'%'},
    {key:'viewDealRate',label:'观看-成交率',icon:'shopping-cart',calc:d=>{const uv=d.reduce((s,r)=>s+(r.uv||0),0);return uv?d.reduce((s,r)=>s+(r.dealBuyers||0),0)/uv*100:0},fmt:v=>v.toFixed(2)+'%'}
  ]},
  {name:'互动/粉丝',items:[
    {key:'expInteractRate',label:'曝光互动率',icon:'message-circle',calc:d=>{const le=d.reduce((s,r)=>s+(r.liveExpose||0),0);return le?d.reduce((s,r)=>s+(r.interactUsers||0),0)/le*100:0},fmt:v=>v.toFixed(2)+'%'},
    {key:'viewInteractRate',label:'观看互动率',icon:'message-circle',calc:d=>{const uv=d.reduce((s,r)=>s+(r.uv||0),0);return uv?d.reduce((s,r)=>s+(r.interactUsers||0),0)/uv*100:0},fmt:v=>v.toFixed(2)+'%'},
    {key:'followRate',label:'转粉率',icon:'user-plus',calc:d=>{const uv=d.reduce((s,r)=>s+(r.uv||0),0);return uv?d.reduce((s,r)=>s+(r.newFans||0),0)/uv*100:0},fmt:v=>v.toFixed(2)+'%'}
  ]},
  {name:'价格/退款',items:[
    {key:'liveAvgPrice',label:'直播客单价',icon:'tag',calc:d=>{const db=d.reduce((s,r)=>s+(r.dealBuyers||0),0);return db?d.reduce((s,r)=>s+(r.gmv||0),0)/db:0},fmt:v=>'¥'+numFmt(Math.round(v))},
    {key:'refundRate',label:'退款率',icon:'percent',calc:d=>{const gmv=d.reduce((s,r)=>s+(r.gmv||0),0);return gmv?d.reduce((s,r)=>s+(r.refund||0),0)/gmv*100:0},fmt:v=>v.toFixed(2)+'%'},
    {key:'refund',label:'退款金额',icon:'rotate-ccw',calc:d=>d.reduce((s,r)=>s+(r.refund||0),0),fmt:v=>moneyFmt(v)}
  ]}
];
const SS_KPI_META = {};
SS_KPI_GROUPS.forEach(g=>g.items.forEach(i=>{SS_KPI_META[i.key]=i}));

// ========== Qianchuan KPI metadata ==========
const QC_KPI_GROUPS = [
  {name:'核心指标',items:[
    {key:'totalSpend',label:'总消耗',icon:'wallet',calc:d=>d.reduce((s,r)=>s+(r.totalSpend||0),0),fmt:v=>moneyFmt(v)},
    {key:'avgDailySpend',label:'日均消耗',icon:'wallet',calc:d=>{const l=d.length;return l?d.reduce((s,r)=>s+(r.totalSpend||0),0)/l:0},fmt:v=>moneyFmt(Math.round(v))},
    {key:'promoGmv',label:'推广GMV',icon:'dollar-sign',calc:d=>d.reduce((s,r)=>s+(r.promoGmv||0),0),fmt:v=>moneyFmt(v)},
    {key:'promoRoi',label:'综合推广ROI',icon:'trending-up',calc:d=>{const s=d.reduce((s,r)=>s+(r.totalSpend||0),0);const g=d.reduce((s,r)=>s+(r.promoGmv||0),0);return s?+(g/s).toFixed(2):0},fmt:v=>v+'x'},
    {key:'avgPromoRoi',label:'日均推广ROI',icon:'bar-chart-3',calc:d=>{const s=d.reduce((s,r)=>s+(r.totalSpend||0),0);const g=d.reduce((s,r)=>s+(r.promoGmv||0),0);return s?+(g/s).toFixed(2):0},fmt:v=>v.toFixed(2)+'x'}
  ]},
  {name:'直播推广',items:[
    {key:'liveSpend',label:'直播花费',icon:'radio',calc:d=>d.reduce((s,r)=>s+(r.liveSpend||0),0),fmt:v=>moneyFmt(v)},
    {key:'livePromoGmv',label:'直播推广GMV',icon:'dollar-sign',calc:d=>d.reduce((s,r)=>s+(r.livePromoGmv||0),0),fmt:v=>moneyFmt(v)},
    {key:'livePromoRoi',label:'直播推广ROI',icon:'trending-up',calc:d=>{const s=d.reduce((s,r)=>s+(r.liveSpend||0),0);const g=d.reduce((s,r)=>s+(r.livePromoGmv||0),0);return s?+(g/s).toFixed(2):0},fmt:v=>v+'x'}
  ]},
  {name:'直投',items:[
    {key:'directSpend',label:'直投花费',icon:'send',calc:d=>d.reduce((s,r)=>s+(r.directSpend||0),0),fmt:v=>moneyFmt(v)},
    {key:'directGmv',label:'直投GMV',icon:'dollar-sign',calc:d=>d.reduce((s,r)=>s+(r.directGmv||0),0),fmt:v=>moneyFmt(v)},
    {key:'directRoi',label:'直投ROI',icon:'trending-up',calc:d=>{const s=d.reduce((s,r)=>s+(r.directSpend||0),0);const g=d.reduce((s,r)=>s+(r.directGmv||0),0);return s?+(g/s).toFixed(2):0},fmt:v=>v+'x'}
  ]},
  {name:'素材',items:[
    {key:'materialSpend',label:'素材花费',icon:'film',calc:d=>d.reduce((s,r)=>s+(r.materialSpend||0),0),fmt:v=>moneyFmt(v)},
    {key:'materialGmv',label:'素材GMV',icon:'dollar-sign',calc:d=>d.reduce((s,r)=>s+(r.materialGmv||0),0),fmt:v=>moneyFmt(v)},
    {key:'materialRoi',label:'素材ROI',icon:'trending-up',calc:d=>{const s=d.reduce((s,r)=>s+(r.materialSpend||0),0);const g=d.reduce((s,r)=>s+(r.materialGmv||0),0);return s?+(g/s).toFixed(2):0},fmt:v=>v+'x'}
  ]},
  {name:'商城推广',items:[
    {key:'mallSpend',label:'商城花费',icon:'shopping-bag',calc:d=>d.reduce((s,r)=>s+(r.mallSpend||0),0),fmt:v=>moneyFmt(v)},
    {key:'mallPromoGmv',label:'商城推广GMV',icon:'dollar-sign',calc:d=>d.reduce((s,r)=>s+(r.mallPromoGmv||0),0),fmt:v=>moneyFmt(v)},
    {key:'mallPromoRoi',label:'商城推广ROI',icon:'trending-up',calc:d=>{const s=d.reduce((s,r)=>s+(r.mallSpend||0),0);const g=d.reduce((s,r)=>s+(r.mallPromoGmv||0),0);return s?+(g/s).toFixed(2):0},fmt:v=>v+'x'}
  ]},
  {name:'综合',items:[
    {key:'shortVideoRatio',label:'短视频引流成交占比',icon:'video',calc:d=>{const g=d.reduce((s,r)=>s+(r.livePromoGmv||0),0);return g?d.reduce((s,r)=>s+(r.shortVideoRatio||0)*(r.livePromoGmv||0),0)/g*100:0},fmt:v=>v.toFixed(2)+'%'},
    {key:'nonGrantSpend',label:'千川非赠款花费',icon:'credit-card',calc:d=>d.reduce((s,r)=>s+(r.nonGrantSpend||0),0),fmt:v=>moneyFmt(v)},
    {key:'nonGrantFeeRatio',label:'非赠款实际费比',icon:'percent',calc:d=>{const s=d.reduce((s,r)=>s+(r.nonGrantSpend||0),0);return s?d.reduce((s,r)=>s+(r.nonGrantFeeRatio||0)*(r.nonGrantSpend||0),0)/s*100:0},fmt:v=>v.toFixed(2)+'%'}
  ]}
];
const QC_KPI_META = {};
QC_KPI_GROUPS.forEach(g=>g.items.forEach(i=>{QC_KPI_META[i.key]=i}));

// ============================================================
//  4. TAB SWITCH
// ============================================================
document.querySelectorAll('.tab-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(t=>t.classList.remove('active','fade-in'));
    state.activeTab = btn.dataset.tab;
    const el = document.getElementById('tab'+state.activeTab.charAt(0).toUpperCase()+state.activeTab.slice(1));
    el.classList.add('active','fade-in');
    setTimeout(()=>renderActiveTab(),50);
  });
});

// Sub-tab shop switch
document.querySelectorAll('.sub-tab').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.sub-tab').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    state.activeShop = btn.dataset.shop;
    renderShopTab();
  });
});

// ============================================================
//  5. FILTER EVENTS
// ============================================================
document.getElementById('shopFilter').addEventListener('change',function(){
  state.shopFilter = this.value;
  renderActiveTab();
});
document.getElementById('startDate').addEventListener('change',function(){state.start=this.value;renderActiveTab()});
document.getElementById('endDate').addEventListener('change',function(){state.end=this.value;renderActiveTab()});
document.querySelectorAll('.gran-btn').forEach(b=>{
  b.addEventListener('click',function(){
    document.querySelectorAll('.gran-btn').forEach(x=>x.classList.remove('active'));
    this.classList.add('active');
    state.gran=this.dataset.gran;renderActiveTab();
  });
});
document.getElementById('compareToggle').addEventListener('click',function(){
  state.compareOn=!state.compareOn;
  this.classList.toggle('active');
  document.getElementById('comparePeriod').classList.toggle('visible');
  renderActiveTab();
});
document.getElementById('compareStart').addEventListener('change',function(){state.cStart=this.value;renderActiveTab()});
document.getElementById('compareEnd').addEventListener('change',function(){state.cEnd=this.value;renderActiveTab()});
document.getElementById('toggleAvgLine').addEventListener('click',function(){this.classList.toggle('active');state.showAvgLine=this.classList.contains('active');renderActiveTab()});
document.getElementById('toggleTop3').addEventListener('click',function(){this.classList.toggle('active');state.showTop3=this.classList.contains('active');renderActiveTab()});
document.getElementById('toggleTable').addEventListener('click',function(){this.classList.toggle('active');state.showTable=this.classList.contains('active');renderActiveTab()});
document.getElementById('shopY1Select').addEventListener('change',()=>renderShopTab());
document.getElementById('shopY2Select').addEventListener('change',()=>renderShopTab());
document.getElementById('channelMallRatioGran').addEventListener('change',()=>renderShopTab());
document.getElementById('ovY1Select').addEventListener('change',()=>renderOverviewTab());
document.getElementById('ovY2Select').addEventListener('change',()=>renderOverviewTab());
document.getElementById('ssY1Select').addEventListener('change',()=>renderSessionTab());
document.getElementById('ssY2Select').addEventListener('change',()=>renderSessionTab());
document.getElementById('qcY1Select').addEventListener('change',()=>renderQianchuanTab());
document.getElementById('qcY2Select').addEventListener('change',()=>renderQianchuanTab());

// ============================================================
//  6. RENDER DISPATCH
// ============================================================
function renderActiveTab(){
  if(state.activeTab==='overview') renderOverviewTab();
  else if(state.activeTab==='shop') renderShopTab();
  else if(state.activeTab==='session') renderSessionTab();
  else if(state.activeTab==='qianchuan') renderQianchuanTab();
  setTimeout(()=>{try{lucide.createIcons()}catch(e){}},100);
}

// ============================================================
//  7. OVERVIEW TAB
// ============================================================
function renderOverviewTab(){
  const data = getFilteredShopData('all');
  if(state.gran!=='day'){
    Object.keys(data).forEach(s=>{ data[s]=aggregateShopData(data[s],state.gran); });
  }
  renderOvKpi(data);
  // 对比周期 KPI
  if(state.compareOn){
    const cData = getFilteredShopDataWithRange('all', state.cStart, state.cEnd);
    if(state.gran!=='day') Object.keys(cData).forEach(s=>{ cData[s]=aggregateShopData(cData[s],state.gran); });
    const cTotal = {gmv:0,gsv:0,orderBuyers:0,refundPayTime:0,prevYearGsv:0,feeSum:0,couponSum:0,nonGrantSpend:0};
    Object.values(cData).forEach(arr=>{arr.forEach(d=>{cTotal.gmv+=d.gmv;cTotal.gsv+=d.gsv;cTotal.orderBuyers+=d.orderBuyers||0;cTotal.refundPayTime+=d.refundPayTime||0;cTotal.prevYearGsv+=d.prevYearGsv||0;cTotal.feeSum+=(d.feeRatio||0)*d.gsv;cTotal.couponSum+=d.coupon||0;})});
    cTotal.nonGrantSpend = cNonGrant;
    // 对比千川总消耗
    let cNonGrant = 0;
    QC_DATA.filter(d=>d.date>=state.cStart&&d.date<=state.cEnd).forEach(d=>{
      if(state.shopFilter==='all'||d.shop===state.shopFilter) cNonGrant+=d.nonGrantSpend||0;
    });
    // 主周期汇总（用于计算同环比）
    const mTotal = {gmv:0,gsv:0,orderBuyers:0,refundPayTime:0,prevYearGsv:0,feeSum:0,couponSum:0,nonGrantSpend:0};
    Object.values(data).forEach(arr=>{arr.forEach(d=>{mTotal.gmv+=d.gmv;mTotal.gsv+=d.gsv;mTotal.orderBuyers+=d.orderBuyers||0;mTotal.refundPayTime+=d.refundPayTime||0;mTotal.prevYearGsv+=d.prevYearGsv||0;mTotal.feeSum+=(d.feeRatio||0)*d.gsv;mTotal.couponSum+=d.coupon||0;})});
    mTotal.nonGrantSpend = mNonGrant;
    let mNonGrant = 0;
    QC_DATA.filter(d=>d.date>=state.start&&d.date<=state.end).forEach(d=>{
      if(state.shopFilter==='all'||d.shop===state.shopFilter) mNonGrant+=d.nonGrantSpend||0;
    });
    renderCompareKpiRow('ovCompareRow', [mTotal], [cTotal], [
      {label:'对比总GMV',icon:'dollar-sign',calc:d=>d.reduce((s,r)=>s+r.gmv,0),fmt:v=>moneyFmt(v)},
      {label:'对比总GSV',icon:'bar-chart-3',calc:d=>d.reduce((s,r)=>s+r.gsv,0),fmt:v=>moneyFmt(v)},
      {label:'对比成交人数',icon:'users',calc:d=>d.reduce((s,r)=>s+(r.orderBuyers||0),0),fmt:v=>numFmt(v)},
      {label:'对比退款率',icon:'percent',calc:d=>{const g=d.reduce((s,r)=>s+r.gmv,0);const rp=d.reduce((s,r)=>s+r.refundPayTime,0);return g?rp/g*100:0},fmt:v=>pctFmt(v)},
      {label:'对比费比',icon:'percent',calc:d=>{const f=d.reduce((s,r)=>s+r.feeSum,0);const g=d.reduce((s,r)=>s+r.gsv,0);return g?+(f/g*100).toFixed(2):0},fmt:v=>pctFmt(v)},
      {label:'对比客单价',icon:'tag',calc:d=>{const g=d.reduce((s,r)=>s+r.gmv,0);const b=d.reduce((s,r)=>s+(r.orderBuyers||0),0);return b?Math.round(g/b):0},fmt:v=>'¥'+numFmt(v)},
      {label:'对比优惠券',icon:'credit-card',calc:d=>d.reduce((s,r)=>s+r.couponSum,0),fmt:v=>moneyFmt(v)},
      {label:'对比总消耗',icon:'wallet',calc:d=>d.reduce((s,r)=>s+(r.nonGrantSpend||0),0),fmt:v=>moneyFmt(v)}
    ]);
  } else {
    document.getElementById('ovCompareRow').style.display='none';
  }
  renderOvShopCompare(data);
  renderOvChart(data);
  renderOvTable(data);
}

function getFilteredShopDataWithRange(forceShop, s, e){
  const shop = forceShop||state.shopFilter;
  let result = {};
  Object.keys(SHOP_DATA).forEach(k=>{
    if(shop!=='all' && k!==shop) return;
    result[k] = filterByDate(SHOP_DATA[k], s, e);
  });
  return result;
}

function getFilteredShopData(forceShop){
  const shop = forceShop||state.shopFilter;
  let result = {};
  Object.keys(SHOP_DATA).forEach(k=>{
    if(shop!=='all' && k!==shop) return;
    result[k] = filterByDate(SHOP_DATA[k],state.start,state.end);
  });
  return result;
}

// ============================================================
//  3.6 KPI PANEL
// ============================================================
function buildKpiPanel(){
  let html = '';
  KPI_GROUPS.forEach(g=>{
    html += '<div class="kpi-panel-group"><h5>'+g.name+'</h5>';
    g.items.forEach(i=>{
      const checked = state.shopKpiSelected.includes(i.key)?'checked':'';
      html += '<label><input type="checkbox" value="'+i.key+'" '+checked+' onchange="toggleKpiMetric(\''+i.key+'\')"> '+i.label+'</label>';
    });
    html += '</div>';
  });
  document.getElementById('kpiPanelBody').innerHTML = html;
}
function toggleKpiPanel(){
  const panel = document.getElementById('shopKpiPanel');
  const show = panel.style.display!=='block';
  panel.style.display = show?'block':'none';
  if(show) buildKpiPanel();
}
function toggleKpiMetric(key){
  const idx = state.shopKpiSelected.indexOf(key);
  if(idx>=0) state.shopKpiSelected.splice(idx,1);
  else state.shopKpiSelected.push(key);
  document.getElementById('kpiCount').textContent = state.shopKpiSelected.length;
  renderActiveTab();
}
function initShopKpiPanel(){
  document.getElementById('kpiCount').textContent = state.shopKpiSelected.length;
}
function initSsKpiPanel(){
  document.getElementById('ssKpiCount').textContent = state.ssKpiSelected.length;
}
// ========== Session KPI panel ==========
function toggleSsKpiPanel(){
  const panel = document.getElementById('ssKpiPanel');
  const show = panel.style.display!=='block';
  panel.style.display = show?'block':'none';
  if(show) buildSsKpiPanel();
}
function toggleSsKpiMetric(key){
  const idx = state.ssKpiSelected.indexOf(key);
  if(idx>=0) state.ssKpiSelected.splice(idx,1);
  else state.ssKpiSelected.push(key);
  document.getElementById('ssKpiCount').textContent = state.ssKpiSelected.length;
  renderActiveTab();
}
function buildSsKpiPanel(){
  let html = '';
  SS_KPI_GROUPS.forEach(g=>{
    html += '<div class="kpi-panel-group"><h5>'+g.name+'</h5>';
    g.items.forEach(i=>{
      const checked = state.ssKpiSelected.indexOf(i.key)>=0?'checked':'';
      html += '<label><input type="checkbox" '+checked+' onchange="toggleSsKpiMetric(\''+i.key+'\')"> '+i.label+'</label>';
    });
    html += '</div>';
  });
  document.getElementById('ssKpiPanelBody').innerHTML = html;
}

// ========== Qianchuan KPI panel ==========
function toggleQcKpiPanel(){
  const panel = document.getElementById('qcKpiPanel');
  const show = panel.style.display!=='block';
  panel.style.display = show?'block':'none';
  if(show) buildQcKpiPanel();
}
function toggleQcKpiMetric(key){
  const idx = state.qcKpiSelected.indexOf(key);
  if(idx>=0) state.qcKpiSelected.splice(idx,1);
  else state.qcKpiSelected.push(key);
  document.getElementById('qcKpiCount').textContent = state.qcKpiSelected.length;
  renderActiveTab();
}
function buildQcKpiPanel(){
  let html = '';
  QC_KPI_GROUPS.forEach(g=>{
    html += '<div class="kpi-panel-group"><h5>'+g.name+'</h5>';
    g.items.forEach(i=>{
      const checked = state.qcKpiSelected.indexOf(i.key)>=0?'checked':'';
      html += '<label><input type="checkbox" '+checked+' onchange="toggleQcKpiMetric(\''+i.key+'\')"> '+i.label+'</label>';
    });
    html += '</div>';
  });
  document.getElementById('qcKpiPanelBody').innerHTML = html;
}
function initQcKpiPanel(){
  document.getElementById('qcKpiCount').textContent = state.qcKpiSelected.length;
}

function renderOvKpi(data){
  let total={gmv:0,orderBuyers:0,gsv:0,prevYearGsv:0,refundPayTime:0};
  Object.keys(data).forEach(k=>{
    data[k].forEach(d=>{total.gmv+=d.gmv;total.orderBuyers+=d.orderBuyers||0;total.gsv+=d.gsv;total.prevYearGsv+=d.prevYearGsv||0;total.refundPayTime+=d.refundPayTime||0});
  });
  const refundRate = total.gmv?((total.refundPayTime/total.gmv)*100):0;
  // 总非赠款消耗（从千川数据汇总）
  let totalNonGrant = 0;
  QC_DATA.filter(d=>d.date>=state.start&&d.date<=state.end).forEach(d=>{
    if(state.shopFilter==='all'||d.shop===state.shopFilter) totalNonGrant+=d.nonGrantSpend||0;
  });
  const totFeeRatio = total.gsv&&totalNonGrant?totalNonGrant/total.gsv*100:0;
  const yoyVal = total.prevYearGsv?((total.gsv-total.prevYearGsv)/total.prevYearGsv*100):0;
  const yoyCls = yoyVal>0?'pct-green':'pct-red';
  const yoyArrow = yoyVal>0?'▲':'▼';
  let prev={gmv:0};
  if(state.compareOn){
    Object.keys(SHOP_DATA).forEach(k=>{
      filterByDate(SHOP_DATA[k],state.cStart,state.cEnd).forEach(d=>{prev.gmv+=d.gmv});
    });
  }
  const ch = calcChange(total.gmv,prev.gmv);
  const html = `
    <div class="kpi-card"><div class="kpi-icon"><i data-lucide="dollar-sign"></i></div>
      <div class="kpi-label">总GMV</div><div class="kpi-value">${moneyFmt(total.gmv)}</div>
      ${ch.label!=='-'?`<div class="kpi-change ${ch.label}">${ch.text}</div>`:''}</div>
    <div class="kpi-card"><div class="kpi-icon"><i data-lucide="bar-chart-3"></i></div>
      <div class="kpi-label">总GSV</div><div class="kpi-value">${moneyFmt(total.gsv)}</div>
      <div class="kpi-change ${yoyCls}">${yoyArrow} ${yoyVal.toFixed(2)}%</div></div>
    <div class="kpi-card"><div class="kpi-icon"><i data-lucide="calendar"></i></div>
      <div class="kpi-label">25年同期GSV</div><div class="kpi-value">${moneyFmt(total.prevYearGsv)}</div></div>
    <div class="kpi-card"><div class="kpi-icon"><i data-lucide="shopping-bag"></i></div>
      <div class="kpi-label">总成交人数</div><div class="kpi-value">${numFmt(total.orderBuyers)}</div></div>
    <div class="kpi-card"><div class="kpi-icon"><i data-lucide="rotate-ccw"></i></div>
      <div class="kpi-label">整体退款率</div><div class="kpi-value">${pctFmt(refundRate)}</div></div>
    <div class="kpi-card"><div class="kpi-icon"><i data-lucide="trending-up"></i></div>
      <div class="kpi-label">综合费比</div><div class="kpi-value">${totFeeRatio.toFixed(2)}%</div></div>
  `;
  document.getElementById('ovKpiRow').innerHTML = html;
}

function renderOvShopCompare(data){
  const shops = Object.keys(data);
  if(!shops.length){document.getElementById('ovShopCompare').innerHTML='<div class="empty-state"><p>暂无数据</p></div>';return;}
  let html='';
  shops.forEach(k=>{
    const d = data[k];
    const gmv = d.reduce((s,r)=>s+r.gmv,0);
    const gsv = d.reduce((s,r)=>s+r.gsv,0);
    const orderBuyers = d.reduce((s,r)=>s+(r.orderBuyers||0),0);
    const refundPayTime = d.reduce((s,r)=>s+(r.refundPayTime||0),0);
    const refundRate = gmv?((refundPayTime/gmv)*100):0;
    const gsvW = d.reduce((s,r)=>s+r.gsv,0);
    const feeRatioW = d.reduce((s,r)=>s+(r.feeRatio||0)*r.gsv,0);
    const avgFeeRatio = gsvW?feeRatioW/gsvW:0;
    html+=`<div class="shop-card">
      <div class="shop-name"><span class="dot" style="background:${SHOP_COLORS[k]}"></span>${SHOP_NAMES[k]}</div>
      <div class="shop-metrics">
        <div class="sm-item"><span class="sm-label">GMV</span><span class="sm-value">${moneyFmt(gmv)}</span></div>
        <div class="sm-item"><span class="sm-label">退款率</span><span class="sm-value">${pctFmt(refundRate)}</span></div>
        <div class="sm-item"><span class="sm-label">成交人数</span><span class="sm-value">${numFmt(orderBuyers)}</span></div>
        <div class="sm-item"><span class="sm-label">店费比</span><span class="sm-value">${(avgFeeRatio*100).toFixed(2)}%</span></div>
      </div>
    </div>`;
  });
  document.getElementById('ovShopCompare').innerHTML = html;
}

function renderOvChart(data){
  const shops = Object.keys(data);
  if(!shops.length){document.getElementById('ovTrendChart').parentElement.innerHTML='<div class="empty-state"><p>暂无数据</p></div>';return;}

  const y1Key = document.getElementById('ovY1Select').value;
  const y2Key = document.getElementById('ovY2Select').value;
  const labels = data[shops[0]].map(d=>d.date);

  // Y1 三店折线 + TOP3 高亮
  const y1Datasets = shops.map(k=>{
    const vals = data[k].map(d=>d[y1Key]||0);
    const top3 = state.showTop3 ? getTop3Indices(vals) : vals.map(()=>false);
    const color = SHOP_COLORS[k];
    return {
      label:SHOP_NAMES[k],
      data:vals,
      borderColor:color,
      backgroundColor:color+'20',
      fill:false,tension:0.3,
      pointRadius:top3.map(h=>h?6:3),
      pointBackgroundColor:top3.map(h=>h?'#c9a962':color),
      pointBorderColor:top3.map(h=>h?'#c9a962':color),
      pointHoverRadius:6
    };
  });

  // 平均线：所有店铺所有点的均值
  const allY1 = shops.flatMap(k=>data[k].map(d=>d[y1Key]||0));
  const avgY1 = allY1.length ? allY1.reduce((s,v)=>s+v,0)/allY1.length : 0;

  let datasets = [...y1Datasets];

  // 对比周期曲线（各店铺汇总）
  if(state.compareOn){
    const cData = {};
    shops.forEach(k=>{ cData[k] = getCompareData('shop',k); });
    const compareTotal = labels.map((_,i)=>shops.reduce((s,k)=>s+((cData[k]&&cData[k][i])?cData[k][i][y1Key]||0:0),0));
    datasets.push({
      label:'对比周期',data:compareTotal,
      type:'line',borderColor:'rgba(201,169,98,0.35)',backgroundColor:'transparent',
      borderDash:[4,3],fill:false,tension:0.3,pointRadius:1,pointHitRadius:5,order:0,yAxisID:'y'
    });
  }

  let y2Scale = null;
  let y2IsPct = false;

  if(y2Key && y2Key!=='none'){
    const pctKeys = ['refundRate','feeRatio','achieveRate','mallAfterRatio'];
    y2IsPct = pctKeys.includes(y2Key) || y2Key==='yoy';
    let y2Data = [];
    let y2LabelText = '';

    if(y2Key==='yoy'){
      const mainSum = labels.map((_,i)=>shops.reduce((s,k)=>s+(data[k][i][y1Key]||0),0));
      let compareSum = [];
      if(state.compareOn){
        const cData = {};
        shops.forEach(k=>{ cData[k] = getCompareData('shop',k); });
        compareSum = labels.map((_,i)=>shops.reduce((s,k)=>s+((cData[k]&&cData[k][i])?cData[k][i][y1Key]||0:0),0));
      } else if(y1Key==='gsv'){
        compareSum = labels.map((_,i)=>shops.reduce((s,k)=>s+(data[k][i].prevYearGsv||0),0));
      }
      y2Data = mainSum.map((v,i)=>compareSum[i]?+((v-compareSum[i])/compareSum[i]*100).toFixed(2):null);
      y2LabelText = '同比变化';
    } else {
      y2Data = labels.map((_,i)=>{
        const vals = shops.map(k=>data[k][i][y2Key]||0);
        const avg = vals.reduce((s,v)=>s+v,0)/vals.length;
        return +(avg*(pctKeys.includes(y2Key)?100:1)).toFixed(2);
      });
      y2LabelText = {refundRate:'退款率',feeRatio:'店费比',achieveRate:'GSV达成率',mallAfterRatio:'商城退后占比'}[y2Key]||y2Key;
    }

    datasets.push({
      label:y2LabelText,
      data:y2Data,
      type:'line',
      borderColor:'#e07b4a',
      backgroundColor:'rgba(224,123,74,0.08)',
      fill:true,tension:0.3,pointRadius:3,
      yAxisID:'y1'
    });

    y2Scale = {
      beginAtZero:true,position:'right',grid:{display:false},
      ticks:{font:{size:10,family:'Inter'},callback:v=>y2IsPct?v+'%':v}
    };
  }

  if(charts.ovTrend){charts.ovTrend.destroy()}
  const ctx = document.getElementById('ovTrendChart').getContext('2d');
  charts.ovTrend = new Chart(ctx,{
    type:'line',data:{labels,datasets},
    options:{
      responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{position:'top',labels:{usePointStyle:true,boxWidth:8,font:{size:11,family:'Inter'}}},
        avgLinePlugin:{enabled:state.showAvgLine,value:avgY1,scaleID:'y',color:'rgba(37,99,235,0.5)',label:'μ 均值'}
      },
      scales:{
        x:{grid:{display:false},ticks:{font:{size:10,family:'Inter'},maxTicksLimit:15}},
        y:{beginAtZero:true,position:'left',grid:{color:'#f0f0f0'},ticks:{font:{size:10,family:'Inter'},callback:v=>moneyFmt(v)}},
        ...(y2Scale?{y1:y2Scale}:{})
      }
    }
  });
}

function renderOvTable(data){
  const shops = Object.keys(data);
  const el = document.getElementById('ovEffTable');
  if(!shops.length){el.querySelector('tbody').innerHTML='<tr><td colspan="7" style="text-align:center;color:var(--text-tertiary)">暂无数据</td></tr>';return;}
  let thead = '<tr><th>指标</th>';
  shops.forEach(k=>{thead+='<th>'+SHOP_NAMES[k]+'</th>'});
  thead+='</tr>';
  const metrics = [
    {key:'gmv',label:'GMV',fmt:v=>moneyFmt(v)},
    {key:'gsv',label:'GSV',fmt:v=>moneyFmt(v)},
    {key:'prevYearGsv',label:'25年同期GSV',fmt:v=>moneyFmt(v)},
    {key:'yoy',label:'同比变化',fmt:null},
    {key:'orderBuyers',label:'成交人数',fmt:v=>numFmt(v)},
    {key:'refundRate',label:'退款率',fmt:v=>pctFmt(v)},
    {key:'feeRatio',label:'店费比',fmt:v=>v.toFixed(2)+'%'},
    {key:'avgPrice',label:'客单价',fmt:v=>'¥'+numFmt(v)}
  ];
  let tbody='';
  metrics.forEach(m=>{
    tbody+='<tr><td style="font-weight:600">'+m.label+'</td>';
    shops.forEach(k=>{
      const d = data[k]; let val;
      if(m.key==='refundRate'){
        const gmv=d.reduce((s,r)=>s+r.gmv,0);const refundPayTime=d.reduce((s,r)=>s+(r.refundPayTime||0),0);
        val = gmv?refundPayTime/gmv*100:0;
      }else if(m.key==='yoy'){
        const gsv=d.reduce((s,r)=>s+r.gsv,0);const p=d.reduce((s,r)=>s+(r.prevYearGsv||0),0);
        val = p?+(gsv-p)/p*100:0;
      }else if(m.key==='avgPrice'){
        const gmv=d.reduce((s,r)=>s+r.gmv,0);const ob=d.reduce((s,r)=>s+(r.orderBuyers||0),0);
        val = ob?gmv/ob:0;
      }else if(m.key==='feeRatio'){
        const gsv=d.reduce((s,r)=>s+r.gsv,0);
        val = gsv?d.reduce((s,r)=>s+(r.feeRatio||0)*r.gsv,0)/gsv*100:0;
      }else{
        val = d.reduce((s,r)=>s+(r[m.key]||0),0);
      }
      if(m.key==='yoy'){
        const cls = val>0?'pct-green':'pct-red';
        const arr = val>0?'▲':'▼';
        tbody+='<td class="num"><span class="'+cls+' pct-change">'+arr+' '+val.toFixed(2)+'%</span></td>';
      }else{
        tbody+='<td class="num">'+m.fmt(val)+'</td>';
      }
    });
    tbody+='</tr>';
  });
  el.querySelector('thead').innerHTML=thead;
  el.querySelector('tbody').innerHTML=tbody;
}

// ============================================================
//  8. SHOP TAB
// ============================================================
function renderShopTab(){
  const k = state.activeShop;
  const data = aggregateShopData(filterByDate(SHOP_DATA[k],state.start,state.end), state.gran);
  renderShopKpi(data,k);
  // 对比周期 KPI（复用主KPI选择）
  if(state.compareOn){
    const cData = aggregateShopData(filterByDate(SHOP_DATA[k],state.cStart,state.cEnd), state.gran);
    const compareItems = state.shopKpiSelected.map(key=>{
      const m = KPI_META[key];
      if(!m) return null;
      return {label:'对比'+m.label, icon:m.icon, calc:m.calc, fmt:m.fmt, skipDelta: m.key==='yoy'};
    }).filter(Boolean);
    renderCompareKpiRow('shopCompareRow', data, cData, compareItems);
  } else {
    document.getElementById('shopCompareRow').style.display='none';
  }
  renderShopChart(data,k);
  renderShopChannel(data,k);
  renderShopTable(data);
}

// ============================================================
//  8a. SHOP CHANNEL (自营vs商城)
// ============================================================
function renderShopChannel(data,k){
  const showEl = document.getElementById('shopChannelCard');
  if(!data.length){
    showEl.style.display='none';
    return;
  }
  showEl.style.display='block';

  // Aggregate
  const totalGsv = data.reduce((s,d)=>s+d.gsv,0);
  const totalLive = data.reduce((s,d)=>s+d.liveGsv,0);
  const totalMall = data.reduce((s,d)=>s+d.mallGsv,0);
  const mallRatioTotal = totalGsv ? +(totalMall/totalGsv*100).toFixed(2) : 0;
  // 商城退后占比 = 列15 — 取筛选期内加权均值
  const mallAfterRatio = totalGsv ? +(data.reduce((s,d)=>s+(d.mallAfterRatio||0)*d.gsv,0)/totalGsv*100).toFixed(2) : 0;

  document.getElementById('shopChannelInfo').textContent = `商城退后占比 ${mallAfterRatio}%`;

  // KPI row (5 cards)
  const kpiHtml = `
    <div class="kpi-card"><div class="kpi-icon"><i data-lucide="dollar-sign"></i></div>
      <div class="kpi-label">自营GSV</div><div class="kpi-value">${moneyFmt(totalGsv)}</div></div>
    <div class="kpi-card"><div class="kpi-icon"><i data-lucide="radio"></i></div>
      <div class="kpi-label">直播GSV</div><div class="kpi-value">${moneyFmt(totalLive)}</div></div>
    <div class="kpi-card"><div class="kpi-icon"><i data-lucide="shopping-cart"></i></div>
      <div class="kpi-label">商城GSV</div><div class="kpi-value">${moneyFmt(totalMall)}</div></div>
    <div class="kpi-card"><div class="kpi-icon"><i data-lucide="percent"></i></div>
      <div class="kpi-label">退后占比</div><div class="kpi-value">${pctFmt(mallAfterRatio)}</div></div>
  `;
  document.getElementById('shopChannelKpi').innerHTML = kpiHtml;
  setTimeout(()=>{try{lucide.createIcons()}catch(e){}},50);

  // --- Doughnut Chart ---
  if(charts.shopDoughnut) charts.shopDoughnut.destroy();
  const dCtx = document.getElementById('shopDoughnutChart').getContext('2d');
  charts.shopDoughnut = new Chart(dCtx,{
    type:'doughnut',
    data:{
      labels:['直播成交','商城成交'],
      datasets:[{
        data:[totalLive,totalMall],
        backgroundColor:['#c9a962','#4a9e8e'],
        borderWidth:0,
        hoverOffset:6
      }]
    },
    options:{
      responsive:true,maintainAspectRatio:false,
      cutout:'68%',
      plugins:{
        legend:{
          position:'bottom',
          labels:{
            usePointStyle:true,boxWidth:8,font:{size:11,family:'Inter'},
            generateLabels:function(chart){
              const ds=chart.data.datasets[0];
              const total=ds.data.reduce((s,v)=>s+v,0);
              return chart.data.labels.map((l,i)=>{
                const val=ds.data[i];
                const pct=total?(val/total*100).toFixed(2):0;
                return {text:l+'  '+moneyFmt(val)+'  '+pct+'%',fillStyle:ds.backgroundColor[i],strokeStyle:'transparent',pointStyle:'circle',fontSize:11};
              });
            }
          }
        },
        tooltip:{
          callbacks:{
            label:function(ctx){
              const total=ctx.dataset.data.reduce((s,v)=>s+v,0);
              const pct=total?(ctx.parsed/total*100).toFixed(2):0;
              return ' '+moneyFmt(ctx.parsed)+' ('+pct+'%)';
            }
          }
        }
      }
    }
  });

  // --- Mall Ratio Trend ---
  renderShopMallTrend(data);

  // --- Stacked Bar: Live vs Mall ---
  renderShopLiveMallStacked(data);
}

function renderShopMallTrend(data){
  const gran = document.getElementById('channelMallRatioGran')?.value||'day';
  let labels, values;
  if(gran==='week'){
    const weeks={};
    data.forEach(d=>{
      const dt=new Date(d.date);
      const wk=d.date.slice(0,7)+'-W'+Math.ceil(dt.getDate()/7);
      if(!weeks[wk]) weeks[wk]={gmv:0,gsv:0,count:0};
      weeks[wk].gsv+=d.gsv;
      weeks[wk].liveGsv=(weeks[wk].liveGsv||0)+d.liveGsv;
      weeks[wk].mallGsv=(weeks[wk].mallGsv||0)+d.mallGsv;
    });
    labels=Object.keys(weeks);
    values=labels.map(w=>weeks[w].gsv?+(weeks[w].mallGsv/weeks[w].gsv*100).toFixed(2):0);
  } else {
    labels=data.map(d=>d.date);
    values=data.map(d=>+(d.mallAfterRatio*100).toFixed(2));
  }
  if(charts.shopMallTrend) charts.shopMallTrend.destroy();
  const ctx = document.getElementById('shopMallTrendChart').getContext('2d');
  charts.shopMallTrend = new Chart(ctx,{
    type:'line',
    data:{
      labels,
      datasets:[{
        label:'商城占比',
        data:values,
        borderColor:'#4a9e8e',
        backgroundColor:'rgba(74,158,142,0.1)',
        fill:true,
        tension:0.3,
        pointRadius:2,
        pointHoverRadius:4
      }]
    },
    options:{
      responsive:true,maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{display:false},
        tooltip:{
          callbacks:{
            label:ctx=>'商城占比: '+ctx.parsed.y+'%'
          }
        }
      },
      scales:{
        x:{grid:{display:false},ticks:{font:{size:9,family:'Inter'},maxTicksLimit:8}},
        y:{beginAtZero:true,max:100,grid:{color:'#f0f0f0'},ticks:{font:{size:9,family:'Inter'},callback:v=>v+'%'}}
      }
    }
  });
}

function renderShopLiveMallStacked(data){
  if(charts.shopLiveMallStacked) charts.shopLiveMallStacked.destroy();
  const labels = data.map(d=>d.date);
  const liveData = data.map(d=>d.liveGsv);
  const mallData = data.map(d=>d.mallGsv);
  const ctx = document.getElementById('shopLiveMallStackedChart').getContext('2d');
  charts.shopLiveMallStacked = new Chart(ctx,{
    type:'bar',
    data:{
      labels,
      datasets:[
        {label:'直播GSV',data:liveData,backgroundColor:'#c9a962',barPercentage:0.7},
        {label:'商城GSV',data:mallData,backgroundColor:'#4a9e8e',barPercentage:0.7}
      ]
    },
    options:{
      responsive:true,maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{position:'top',labels:{usePointStyle:true,boxWidth:8,font:{size:11,family:'Inter'}}},
        tooltip:{
          callbacks:{
            label:function(ctx){
              const ds=ctx.dataset.label;
              const val=ctx.parsed.y;
              let total=0;
              for(let j=0;j<ctx.chart.data.datasets.length;j++){
                total+=ctx.chart.data.datasets[j].data[ctx.dataIndex];
              }
              const pct=total?(val/total*100).toFixed(2):0;
              return ds+': '+moneyFmt(val)+' ('+pct+'%)';
            }
          }
        }
      },
      scales:{
        x:{stacked:true,grid:{display:false},ticks:{font:{size:9,family:'Inter'},maxTicksLimit:15}},
        y:{stacked:true,beginAtZero:true,grid:{color:'#f0f0f0'},ticks:{font:{size:9,family:'Inter'},callback:v=>moneyFmt(v)}}
      }
    }
  });
}

function renderShopKpi(data,k){
  const selKeys = state.shopKpiSelected;
  if(!selKeys.length){document.getElementById('shopKpiRow').innerHTML='<div class="empty-state"><p>请选择指标</p></div>';return;}
  let html = '';
  selKeys.forEach(key=>{
    const meta = KPI_META[key];
    if(!meta) return;
    const val = meta.calc(data);
    let valHtml = meta.fmt(val);
    html += '<div class="kpi-card"><div class="kpi-icon"><i data-lucide="'+meta.icon+'"></i></div><div class="kpi-label">'+meta.label+'</div><div class="kpi-value">'+valHtml+'</div></div>';
  });
  document.getElementById('shopKpiRow').innerHTML = html;
  setTimeout(()=>{try{lucide.createIcons()}catch(e){}},50);
}

function renderShopChart(data,k){
  if(!data.length){document.getElementById('shopChart').parentElement.innerHTML='<div class="empty-state"><p>暂无数据</p></div>';return;}
  const y1Key = document.getElementById('shopY1Select').value;
  const y2Key = document.getElementById('shopY2Select').value;
  const labels = data.map(d=>d.date);
  const y1Data = data.map(d=>d[y1Key]||0);

  const pctKeys = ['refundRate','refundRateTime','feeRatio','expClickRate','clickConvRate','expConvRate','mallBeforeRatio','mallAfterRatio','achieveRate'];
  const y2IsPct = pctKeys.includes(y2Key) || y2Key==='yoy';

  // TOP3 高亮 + 平均线
  const top3 = state.showTop3 ? getTop3Indices(y1Data) : y1Data.map(()=>false);
  const y1BarColors = top3.map(h=>h?'#b08d4b':'rgba(201,169,98,0.6)');
  const y1BorderColors = top3.map(h=>h?'#c9a962':'#c9a962');
  const avgY1 = y1Data.length ? y1Data.reduce((s,v)=>s+v,0)/y1Data.length : 0;

  // Y2 数据
  let y2Data, y2LabelText;
  if(y2Key==='yoy'){
    if(state.compareOn){
      const compareData = getCompareData('shop',k);
      y2Data = getPeriodChange(data, compareData, 'gsv', false);
    } else {
      y2Data = data.map(d=>d.prevYearGsv?+((d.gsv-d.prevYearGsv)/d.prevYearGsv*100).toFixed(2):null);
    }
    y2LabelText = '同比变化';
  } else {
    y2Data = data.map(d=>pctKeys.includes(y2Key)?(d[y2Key]||0)*100:d[y2Key]||0);
    y2LabelText = {refundRate:'自营退款率',refundRateTime:'自营退款率(退款时间)',feeRatio:'店费比',expClickRate:'曝光点击率',clickConvRate:'点击转化率',expConvRate:'曝光转化率',achieveRate:'GSV达成率',mallBeforeRatio:'商城退前占比',mallAfterRatio:'商城退后占比'}[y2Key]||y2Key;
  }

  const y1Label = {gmv:'GMV',gsv:'GSV',orderBuyers:'成交人数',liveGsv:'直播GSV',mallGsv:'商城GSV',payGsv:'用户支付GSV',prevYearGsv:'25年同期GSV'}[y1Key]||y1Key;

  const shopDatasets = [
    {label:y1Label,data:y1Data,backgroundColor:y1BarColors,borderColor:y1BorderColors,borderWidth:1,order:2,yAxisID:'y'},
    {label:y2LabelText,data:y2Data,type:'line',borderColor:'#e07b4a',backgroundColor:'rgba(224,123,74,0.08)',fill:true,tension:0.3,pointRadius:3,order:1,yAxisID:'y1'}
  ];
  // 对比周期曲线
  if(state.compareOn && y1Key!=='prevYearGsv'){
    const cData = getCompareData('shop',k);
    const cVals = alignByDate(labels, cData, y1Key);
    if(cVals.some(v=>v!==null)){
      shopDatasets.push({
        label:'对比周期',data:cVals,
        type:'line',borderColor:'rgba(201,169,98,0.35)',backgroundColor:'transparent',
        borderDash:[4,3],fill:false,tension:0.3,pointRadius:1,pointHitRadius:5,order:0,yAxisID:'y'
      });
    }
  }

  if(charts.shop){charts.shop.destroy()}
  const ctx = document.getElementById('shopChart').getContext('2d');
  charts.shop = new Chart(ctx,{
    type:'bar',data:{
      labels,
      datasets: shopDatasets
    },
    options:{
      responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{position:'top',labels:{usePointStyle:true,boxWidth:8,font:{size:11,family:'Inter'}}},
        avgLinePlugin:{enabled:state.showAvgLine,value:avgY1,scaleID:'y',color:'rgba(37,99,235,0.5)',label:'μ 均值'}
      },
      scales:{
        x:{grid:{display:false},ticks:{font:{size:10,family:'Inter'},maxTicksLimit:15}},
        y:{beginAtZero:true,position:'left',grid:{color:'#f0f0f0'},ticks:{font:{size:10,family:'Inter'},callback:v=>moneyFmt(v)}},
        y1:{beginAtZero:true,position:'right',grid:{display:false},ticks:{font:{size:10,family:'Inter'},callback:v=>y2IsPct?v+'%':v}}
      }
    }
  });
}

function renderShopTable(data){
  const show = state.showTable;
  document.getElementById('shopTableCard').style.display = show?'block':'none';
  if(!show) return;
  const total = data.length;
  const pg = state.shopPage;
  const sz = state.pageSize;
  const pages = Math.ceil(total/sz)||1;
  const start = (pg-1)*sz;
  const pageData = data.slice(start,start+sz);
  document.getElementById('shopTableInfo').textContent = `共 ${total} 条 | 第 ${pg}/${pages} 页`;
  if(!total){document.getElementById('shopTableWrap').innerHTML='<div class="empty-state"><p>暂无数据</p></div>';return;}
  let html = '<table><thead><tr><th>日期</th><th class="num">GMV</th><th class="num">GSV</th><th class="num">25年同期</th><th class="num">同比</th><th class="num">成交人数</th><th class="num">退款率</th><th class="num">费比</th><th class="num">客单价</th><th class="num">补贴</th><th class="num">优惠券</th></tr></thead><tbody>';
  pageData.forEach(d=>{
    const yoyVal = d.prevYearGsv?((d.gsv-d.prevYearGsv)/d.prevYearGsv*100):0;
    const yoyCls = yoyVal>0?'pct-green':'pct-red';
    const yoyArr = yoyVal>0?'▲':'▼';
    html+=`<tr><td>${d.date}</td><td class="num">${moneyFmt(d.gmv)}</td><td class="num">${moneyFmt(d.gsv)}</td>
      <td class="num">${d.prevYearGsv?moneyFmt(d.prevYearGsv):'—'}</td>
      <td class="num"><span class="${yoyCls} pct-change">${yoyArr} ${yoyVal.toFixed(2)}%</span></td>
      <td class="num">${numFmt(d.orderBuyers||0)}</td>
      <td class="num"><span class="${d.refundRate>0.08?'pct-red':d.refundRate>0.05?'pct-yellow':'pct-green'} pct-change">${(d.refundRate*100).toFixed(2)}%</span></td>
      <td class="num">${(d.feeRatio*100).toFixed(2)}%</td><td class="num">¥${numFmt(Math.round(d.avgPrice))}</td>
      <td class="num">${moneyFmt(d.subsidy)}</td><td class="num">${moneyFmt(d.coupon)}</td></tr>`;
  });
  html+='</tbody></table>';
  document.getElementById('shopTableWrap').innerHTML = html;
  // pagination
  let btns='';
  for(let i=1;i<=pages;i++){
    btns+=`<button class="page-btn${i===pg?' active':''}" data-page="${i}" data-target="shop">${i}</button>`;
  }
  document.getElementById('shopPageBtns').innerHTML = btns;
  document.getElementById('shopPageInfo').textContent = `第 ${pg} / ${pages} 页`;
  document.querySelectorAll('#shopTableFooter .page-btn').forEach(b=>{
    b.addEventListener('click',function(){
      state.shopPage = parseInt(this.dataset.page);
      renderShopTable(filterByDate(SHOP_DATA[state.activeShop],state.start,state.end));
    });
  });
}

// ============================================================
//  9. SESSION TAB
// ============================================================
function getISOWeek(dateStr){
  const d = new Date(dateStr);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day + 3);
  const year = d.getFullYear();
  const firstThursday = new Date(year, 0, 4);
  const firstDay = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstDay);
  const days = Math.floor((d - firstThursday) / 86400000);
  const week = Math.floor(days / 7) + 1;
  return `${year}-W${String(week).padStart(2,'0')}`;
}

function aggregateSessionData(data, gran){
  if(gran==='day' || !data.length) return data;
  const map={};
  const sumKeys=['gmv','refund','gsv','durMin','durHour','liveExpose','uv','prodExpose','prodClick','dealBuyers','interactUsers','newFans','sessions'];
  data.forEach(d=>{
    const key = gran==='week'?getISOWeek(d.date):d.date.slice(0,7);
    if(!map[key]) map[key]={date:key, shop:state.shopFilter, count:0, weightedViewSec:0, timeRanges:new Set()};
    const o=map[key];
    o.count++;
    sumKeys.forEach(k=>{ o[k]=(o[k]||0)+(d[k]||0); });
    o.weightedViewSec += (d.avgViewSec||0)*(d.uv||0);
    if(d.timeRange) o.timeRanges.add(d.timeRange);
  });
  return Object.values(map).map(o=>{
    o.avgViewSec = o.uv ? o.weightedViewSec/o.uv : 0;
    o.gsvPerHour = o.durHour ? o.gsv/o.durHour : 0;
    o.gpm = o.uv ? o.gmv/o.uv*1000 : 0;
    o.refundRate = o.gmv ? o.refund/o.gmv : 0;
    o.expViewRate = o.liveExpose ? o.uv/o.liveExpose : 0;
    o.viewProdExposeRate = o.uv ? o.prodExpose/o.uv : 0;
    o.prodExpClickRate = o.prodExpose ? o.prodClick/o.prodExpose : 0;
    o.prodClickDealRate = o.prodClick ? o.dealBuyers/o.prodClick : 0;
    o.liveExpDealRate = o.liveExpose ? o.dealBuyers/o.liveExpose : 0;
    o.viewDealRate = o.uv ? o.dealBuyers/o.uv : 0;
    o.expInteractRate = o.liveExpose ? o.interactUsers/o.liveExpose : 0;
    o.viewInteractRate = o.uv ? o.interactUsers/o.uv : 0;
    o.followRate = o.uv ? o.newFans/o.uv : 0;
    o.uvPerHour = o.durHour ? o.uv/o.durHour : 0;
    o.liveAvgPrice = o.dealBuyers ? o.gmv/o.dealBuyers : 0;
    o.timeRange = o.timeRanges.size ? Array.from(o.timeRanges).slice(0,3).join(', ') : '—';
    delete o.weightedViewSec; delete o.timeRanges; delete o.count;
    return o;
  });
}

function aggregateShopData(data, gran){
  if(gran==='day'||!data.length) return data;
  const map={};
  const sumKeys=['gmv','gsv','subsidy','coupon','payGsv','refundAmt','gsvTarget','prevYearGsv','liveGsv','mallGsv','refundPayTime','liveRefund','mallRefund','liveAmt','cardOrder','otherRe','shortVideo','orderBuyers','clickUsers','exposeUsers'];
  data.forEach(d=>{
    const key=gran==='week'?getISOWeek(d.date):d.date.slice(0,7);
    if(!map[key]) map[key]={date:key,count:0,gsvWeight:0,feeRatioW:0};
    const o=map[key];
    o.count++;o.gsvWeight+=d.gsv;o.feeRatioW+=(d.feeRatio||0)*d.gsv;
    sumKeys.forEach(k=>{o[k]=(o[k]||0)+(d[k]||0)});
  });
  return Object.values(map).map(o=>{
    o.refundRate=o.gmv?o.refundPayTime/o.gmv:0;
    o.achieveRate=o.gsvTarget?o.gsv/o.gsvTarget:0;
    o.yoy=o.prevYearGsv?(o.gsv-o.prevYearGsv)/o.prevYearGsv:0;
    o.mallBeforeRatio=o.gmv?(o.cardOrder+o.otherRe+o.shortVideo)/o.gmv:0;
    o.mallAfterRatio=o.gsv?o.mallGsv/o.gsv:0;
    o.feeRatio=o.gsvWeight?o.feeRatioW/o.gsvWeight:0;
    o.avgPrice=o.orderBuyers?o.gmv/o.orderBuyers:0;
    o.expClickRate=o.exposeUsers?o.clickUsers/o.exposeUsers:0;
    o.clickConvRate=o.clickUsers?o.orderBuyers/o.clickUsers:0;
    o.expConvRate=o.exposeUsers?o.orderBuyers/o.exposeUsers:0;
    o.refundRateTime=o.gmv?o.refundAmt/o.gmv:0;
    o.liveRefundRate=o.liveAmt?o.liveRefund/o.liveAmt:0;
    o.mallRefundRate=(o.cardOrder+o.otherRe+o.shortVideo)?o.mallRefund/(o.cardOrder+o.otherRe+o.shortVideo):0;
    delete o.count;delete o.gsvWeight;delete o.feeRatioW;
    return o;
  });
}
function aggregateQcData(data, gran){
  if(gran==='day'||!data.length) return data;
  const map={};
  const sumKeys=['totalSpend','promoGmv','liveSpend','livePromoGmv','directSpend','directGmv','materialSpend','materialGmv','mallSpend','mallPromoGmv','nonGrantSpend'];
  data.forEach(d=>{
    const key=gran==='week'?getISOWeek(d.date):d.date.slice(0,7);
    if(!map[key]) map[key]={date:key,count:0,shortRatioW:0,liveGmvWeight:0,nonGrantW:0,gsvW:0};
    const o=map[key];
    o.count++;o.shortRatioW+=(d.shortVideoRatio||0)*(d.livePromoGmv||0);
    o.liveGmvWeight+=d.livePromoGmv||0;
    o.nonGrantW+=(d.nonGrantFeeRatio||0)*(d.nonGrantSpend||0);
    o.gsvW+=d.nonGrantSpend||0;
    sumKeys.forEach(k=>{o[k]=(o[k]||0)+(d[k]||0)});
  });
  return Object.values(map).map(o=>{
    o.promoRoi=+(o.totalSpend?o.promoGmv/o.totalSpend:0).toFixed(2);
    o.livePromoRoi=+(o.liveSpend?o.livePromoGmv/o.liveSpend:0).toFixed(2);
    o.directRoi=+(o.directSpend?o.directGmv/o.directSpend:0).toFixed(2);
    o.materialRoi=+(o.materialSpend?o.materialGmv/o.materialSpend:0).toFixed(2);
    o.mallPromoRoi=+(o.mallSpend?o.mallPromoGmv/o.mallSpend:0).toFixed(2);
    o.shortVideoRatio=o.liveGmvWeight?o.shortRatioW/o.liveGmvWeight:0;
    o.nonGrantFeeRatio=o.gsvW?o.nonGrantW/o.gsvW:0;
    delete o.count;delete o.shortRatioW;delete o.liveGmvWeight;delete o.nonGrantW;delete o.gsvW;
    return o;
  });
}
function renderSessionTab(){
  let data = SESSION_DATA;
  if(state.shopFilter!=='all') data = data.filter(d=>d.shop===state.shopFilter);
  data = filterByDate(data,state.start,state.end,'date');
  data = aggregateSessionData(data, state.gran);
  renderSsKpi(data);
  // 对比周期 KPI（复用主KPI选择）
  if(state.compareOn){
    let cData = SESSION_DATA;
    if(state.shopFilter!=='all') cData = cData.filter(d=>d.shop===state.shopFilter);
    cData = aggregateSessionData(filterByDate(cData,state.cStart,state.cEnd,'date'), state.gran);
    const compareItems = state.ssKpiSelected.map(key=>{
      const m = SS_KPI_META[key];
      if(!m) return null;
      return {label:'对比'+m.label, icon:m.icon, calc:m.calc, fmt:m.fmt, skipDelta: m.key==='yoy'};
    }).filter(Boolean);
    renderCompareKpiRow('ssCompareRow', data, cData, compareItems);
  } else {
    document.getElementById('ssCompareRow').style.display='none';
  }
  renderSsChart(data);
  renderSsScatter(data);
  renderSsRank(data);
  renderSsTable(data);
}

function renderSsKpi(data){
  const selKeys = state.ssKpiSelected;
  document.getElementById('ssKpiCount').textContent = selKeys.length;
  if(!selKeys.length){document.getElementById('ssKpiRow').innerHTML='';return;}
  let html = '';
  selKeys.forEach(key=>{
    const info = SS_KPI_META[key];
    if(!info) return;
    const val = info.calc(data);
    html += `<div class="kpi-card"><div class="kpi-icon"><i data-lucide="${info.icon}"></i></div>
      <div class="kpi-label">${info.label}</div><div class="kpi-value">${info.fmt(val)}</div></div>`;
  });
  document.getElementById('ssKpiRow').innerHTML = html;
  setTimeout(()=>{try{lucide.createIcons()}catch(e){}},50);
}

function renderSsChart(data){
  if(!data.length){document.getElementById('ssChart').parentElement.innerHTML='<div class="empty-state"><p>暂无场次数据</p></div>';return;}
  const sorted = [...data].sort((a,b)=>a.date.localeCompare(b.date));
  const y1Key = document.getElementById('ssY1Select').value;
  const y2Key = document.getElementById('ssY2Select').value;
  const pctKeys = ['refundRate','expViewRate','viewProdExposeRate','prodExpClickRate','prodClickDealRate','liveExpDealRate','viewDealRate','expInteractRate','viewInteractRate','followRate'];
  const isPct = pctKeys.includes(y2Key) || y2Key==='yoy';
  const labels = sorted.map(d=>d.date);
  const y1Data = sorted.map(d=>d[y1Key]||0);

  // TOP3 高亮 + 平均线
  const top3 = state.showTop3 ? getTop3Indices(y1Data) : y1Data.map(()=>false);
  const y1BarColors = top3.map(h=>h?'#b08d4b':'rgba(201,169,98,0.6)');
  const y1BorderColors = top3.map(h=>h?'#c9a962':'#c9a962');
  const avgY1 = y1Data.length ? y1Data.reduce((s,v)=>s+v,0)/y1Data.length : 0;

  // Y2 数据
  let y2Data, y2LabelText;
  if(y2Key==='yoy'){
    const compareData = state.compareOn ? getCompareData('session') : [];
    y2Data = getPeriodChange(sorted, compareData, y1Key, false);
    y2LabelText = '同比变化';
  } else {
    y2Data = sorted.map(d=>isPct?(d[y2Key]||0)*100:d[y2Key]);
    y2LabelText = {refundRate:'退款率',expViewRate:'曝光观看率',viewProdExposeRate:'观看-商品曝光率',prodExpClickRate:'商品曝光点击率',prodClickDealRate:'商品点击成交率',liveExpDealRate:'曝光成交率',viewDealRate:'观看成交率',expInteractRate:'曝光互动率',viewInteractRate:'观看互动率',followRate:'转粉率'}[y2Key]||'指标';
  }

  const y1Labels = {gmv:'GMV',gsv:'GSV',uv:'UV',dealBuyers:'成交人数',durMin:'时长(分)',durHour:'时长(时)',refund:'退款金额'};
  const y1Label = y1Labels[y1Key]||'指标';

  const ssDatasets = [
    {label:y1Label,data:y1Data,backgroundColor:y1BarColors,borderColor:y1BorderColors,borderWidth:1,order:2,yAxisID:'y'},
    {label:y2LabelText,data:y2Data,type:'line',borderColor:'#4a9e8e',backgroundColor:'rgba(74,158,142,0.08)',fill:true,tension:0.3,pointRadius:3,order:1,yAxisID:'y1'}
  ];
  // 对比周期曲线
  if(state.compareOn){
    const cData = getCompareData('session');
    const cVals = alignByDate(labels, cData, y1Key);
    if(cVals.some(v=>v!==null)){
      ssDatasets.push({
        label:'对比周期',data:cVals,
        type:'line',borderColor:'rgba(74,158,142,0.35)',backgroundColor:'transparent',
        borderDash:[4,3],fill:false,tension:0.3,pointRadius:1,pointHitRadius:5,order:0,yAxisID:'y'
      });
    }
  }

  if(charts.ss){charts.ss.destroy()}
  const ctx = document.getElementById('ssChart').getContext('2d');
  charts.ss = new Chart(ctx,{
    type:'bar',data:{
      labels,
      datasets: ssDatasets
    },
    options:{
      responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{position:'top',labels:{usePointStyle:true,boxWidth:8,font:{size:11,family:'Inter'}}},
        avgLinePlugin:{enabled:state.showAvgLine,value:avgY1,scaleID:'y',color:'rgba(37,99,235,0.5)',label:'μ 均值'}
      },
      scales:{
        x:{grid:{display:false},ticks:{font:{size:9,family:'Inter'},maxTicksLimit:20}},
        y:{beginAtZero:true,grid:{color:'#f0f0f0'},ticks:{font:{size:10,family:'Inter'},callback:v=>moneyFmt(v)}},
        y1:{beginAtZero:true,position:'right',grid:{display:false},ticks:{font:{size:10,family:'Inter'},callback:v=>isPct?v+'%':v.toFixed(2)}}
      }
    }
  });
}

function renderSsScatter(data){
  if(!data.length){document.getElementById('ssScatterChart').parentElement.innerHTML='<div class="empty-state"><p>暂无场次数据</p></div>';return;}
  const datasets = {};
  data.forEach(d=>{
    if(!datasets[d.shop]) datasets[d.shop]={label:SHOP_NAMES[d.shop],data:[],backgroundColor:SHOP_COLORS[d.shop],borderColor:SHOP_COLORS[d.shop]};
    datasets[d.shop].data.push({x:d.uv||0,y:d.gmv});
  });
  if(charts.ssScatter){charts.ssScatter.destroy()}
  const ctx = document.getElementById('ssScatterChart').getContext('2d');
  charts.ssScatter = new Chart(ctx,{
    type:'scatter',data:{datasets:Object.values(datasets)},
    options:{
      responsive:true,maintainAspectRatio:false,
      plugins:{legend:{position:'top',labels:{usePointStyle:true,boxWidth:8,font:{size:11,family:'Inter'}}}},
      scales:{
        x:{title:{display:true,text:'场观UV',font:{size:11,family:'Inter'}},grid:{color:'#f0f0f0'},ticks:{font:{size:10,family:'Inter'}}},
        y:{title:{display:true,text:'GMV (元)',font:{size:11,family:'Inter'}},beginAtZero:true,grid:{color:'#f0f0f0'},ticks:{font:{size:10,family:'Inter'},callback:v=>moneyFmt(v)}}
      }
    }
  });
}

function renderSsRank(data){
  const ranked = [...data].sort((a,b)=>b.gmv-a.gmv).slice(0,20);
  const maxGmv = ranked.length?ranked[0].gmv:1;
  let html='<thead><tr><th>排名</th><th>日期</th><th>主要时段</th><th class="num">GMV</th><th class="num">UV</th><th class="num">GPM</th><th>效率</th></tr></thead><tbody>';
  ranked.forEach((d,i)=>{
    const pct = (d.gmv/maxGmv*100).toFixed(0);
    let rankClass = i===0?'gold':i===1?'silver':i===2?'bronze':'';
    let gpm = d.gpm||0;
    let effClass = gpm>=3000?'s':gpm>=2000?'a':gpm>=1000?'b':'c';
    let effLabel = gpm>=3000?'S':gpm>=2000?'A':gpm>=1000?'B':'C';
    html+=`<tr><td><span class="rank-badge ${rankClass}">${i+1}</span></td>
      <td style="font-weight:600">${d.date}</td>
      <td>${d.timeRange||'—'}</td>
      <td class="num">${moneyFmt(d.gmv)}</td>
      <td class="num">${numFmt(d.uv||0)}</td>
      <td class="num">${numFmt(gpm)}</td>
      <td><div class="prog-bar"><div class="fill ${pct>80?'high':''}" style="width:${pct}%"></div></div> <span class="eff-tag eff-${effClass}">${effLabel}</span></td></tr>`;
  });
  html+='</tbody>';
  document.getElementById('ssRankTable').innerHTML = html;
}

function renderSsTable(data){
  const show = state.showTable;
  document.getElementById('ssTableCard').style.display = show?'block':'none';
  if(!show) return;
  const total = data.length;
  const pg = state.ssPage;
  const sz = state.pageSize;
  const pages = Math.ceil(total/sz)||1;
  const start = (pg-1)*sz;
  const pageData = data.slice(start,start+sz);
  document.getElementById('ssTableInfo').textContent = `共 ${total} 条 | 第 ${pg}/${pages} 页`;
  if(!total){document.getElementById('ssTableWrap').innerHTML='<div class="empty-state"><p>暂无数据</p></div>';return;}
  let html = '<table><thead><tr><th>日期</th><th>主要时段</th><th>店铺</th><th class="num">时长</th><th class="num">GMV</th><th class="num">UV</th><th class="num">GPM</th><th class="num">退款率</th><th class="num">人均观看s</th></tr></thead><tbody>';
  pageData.forEach(d=>{
    html+=`<tr><td>${d.date}</td><td>${d.timeRange||'—'}</td><td>${SHOP_NAMES[d.shop]}</td>
      <td class="num">${Math.round(d.durMin||0)}min</td><td class="num">${moneyFmt(d.gmv)}</td>
      <td class="num">${numFmt(d.uv||0)}</td>
      <td class="num">${numFmt(d.gpm||0)}</td>
      <td class="num"><span class="${(d.refundRate||0)>0.08?'pct-red':(d.refundRate||0)>0.05?'pct-yellow':'pct-green'} pct-change">${((d.refundRate||0)*100).toFixed(2)}%</span></td>
      <td class="num">${numFmt(d.avgViewSec||0)}</td></tr>`;
  });
  html+='</tbody></table>';
  document.getElementById('ssTableWrap').innerHTML = html;
  state.ssPage = pg;
}

// ============================================================
//  10. QIANCHUAN TAB
// ============================================================
function renderQianchuanTab(){
  let data = QC_DATA;
  if(state.shopFilter!=='all') data = data.filter(d=>d.shop===state.shopFilter);
  data = filterByDate(data,state.start,state.end,'date');
  data = aggregateQcData(data, state.gran);
  renderQcKpi(data);
  // 对比周期 KPI（复用主KPI选择）
  if(state.compareOn){
    let cData = QC_DATA;
    if(state.shopFilter!=='all') cData = cData.filter(d=>d.shop===state.shopFilter);
    cData = aggregateQcData(filterByDate(cData,state.cStart,state.cEnd,'date'), state.gran);
    const compareItems = state.qcKpiSelected.map(key=>{
      const m = QC_KPI_META[key];
      if(!m) return null;
      return {label:'对比'+m.label, icon:m.icon, calc:m.calc, fmt:m.fmt, skipDelta: m.key==='yoy'};
    }).filter(Boolean);
    renderCompareKpiRow('qcCompareRow', data, cData, compareItems);
  } else {
    document.getElementById('qcCompareRow').style.display='none';
  }
  renderQcSpendChart(data);
  renderQcRoiChart(data);
  renderQcRank(data);
  renderQcTable(data);
}

function renderQcKpi(data){
  const selKeys = state.qcKpiSelected;
  document.getElementById('qcKpiCount').textContent = selKeys.length;
  if(!selKeys.length){document.getElementById('qcKpiRow').innerHTML='';return;}
  let html = '';
  selKeys.forEach(key=>{
    const info = QC_KPI_META[key];
    if(!info) return;
    const val = info.calc(data);
    html += `<div class="kpi-card"><div class="kpi-icon"><i data-lucide="${info.icon}"></i></div>
      <div class="kpi-label">${info.label}</div><div class="kpi-value">${info.fmt(val)}</div></div>`;
  });
  document.getElementById('qcKpiRow').innerHTML = html;
}

function renderQcSpendChart(data){
  if(!data.length){document.getElementById('qcSpendChart').parentElement.innerHTML='<div class="empty-state"><p>暂无推广数据</p></div>';return;}
  const y1Key = document.getElementById('qcY1Select').value;
  const y2Key = document.getElementById('qcY2Select').value;
  const roiKeys = ['promoRoi','livePromoRoi','directRoi','materialRoi','mallPromoRoi'];
  const pctKeys = ['nonGrantFeeRatio','shortVideoRatio'];
  const isPct = pctKeys.includes(y2Key) || y2Key==='yoy';

  // 按日期聚合 Y1
  const map={};
  data.forEach(d=>{if(!map[d.date]) map[d.date]={}; map[d.date][y1Key]=(map[d.date][y1Key]||0)+(d[y1Key]||0);});
  const sorted = Object.keys(map).sort();
  const labels = sorted;
  const y1Data = sorted.map(k=>map[k][y1Key]||0);

  // TOP3 高亮 + 平均线
  const top3 = state.showTop3 ? getTop3Indices(y1Data) : y1Data.map(()=>false);
  const y1BarColors = top3.map(h=>h?'#b08d4b':'rgba(201,169,98,0.6)');
  const y1BorderColors = top3.map(h=>h?'#c9a962':'#c9a962');
  const avgY1 = y1Data.length ? y1Data.reduce((s,v)=>s+v,0)/y1Data.length : 0;

  // Y2 数据
  let y2Data = [], y2LabelText = '';
  if(y2Key==='yoy'){
    const compareData = state.compareOn ? getCompareData('qianchuan') : [];
    y2Data = getPeriodChange(sorted.map(k=>({date:k,[y1Key]:map[k][y1Key]})), compareData, y1Key, false);
    y2LabelText = '同比变化';
  } else {
    const y2Map={};
    data.forEach(d=>{if(!y2Map[d.date]) y2Map[d.date]={sum:0,count:0}; y2Map[d.date].sum+=(d[y2Key]||0); y2Map[d.date].count++;});
    y2Data = sorted.map(k=>y2Map[k]?+(y2Map[k].sum/y2Map[k].count*(pctKeys.includes(y2Key)?100:1)).toFixed(2):0);
    y2LabelText = {promoRoi:'推广ROI',livePromoRoi:'直播推广ROI',directRoi:'直投ROI',materialRoi:'素材ROI',mallPromoRoi:'商城推广ROI',nonGrantFeeRatio:'非赠款费比',shortVideoRatio:'短视频成交占比'}[y2Key]||y2Key;
  }

  const y1Labels = {totalSpend:'总消耗',promoGmv:'推广GMV',liveSpend:'直播花费',livePromoGmv:'直播推广GMV',directSpend:'直投花费',directGmv:'直投GMV',materialSpend:'素材花费',materialGmv:'素材GMV',mallSpend:'商城花费',mallPromoGmv:'商城推广GMV',nonGrantSpend:'非赠款花费'};
  const y1Label = y1Labels[y1Key]||y1Key;

  const qcDatasets = [
    {label:y1Label,data:y1Data,backgroundColor:y1BarColors,borderColor:y1BorderColors,borderWidth:1,order:2,yAxisID:'y'},
    {label:y2LabelText,data:y2Data,type:'line',borderColor:'#4a9e8e',backgroundColor:'rgba(74,158,142,0.08)',fill:true,tension:0.3,pointRadius:3,order:1,yAxisID:'y1'}
  ];
  // 对比周期曲线
  if(state.compareOn){
    const cData = getCompareData('qianchuan');
    const cVals = alignByDate(labels, cData, y1Key);
    if(cVals.some(v=>v!==null)){
      qcDatasets.push({
        label:'对比周期',data:cVals,
        type:'line',borderColor:'rgba(74,158,142,0.35)',backgroundColor:'transparent',
        borderDash:[4,3],fill:false,tension:0.3,pointRadius:1,pointHitRadius:5,order:0,yAxisID:'y'
      });
    }
  }

  if(charts.qcSpend){charts.qcSpend.destroy()}
  const ctx = document.getElementById('qcSpendChart').getContext('2d');
  charts.qcSpend = new Chart(ctx,{
    type:'bar',data:{
      labels,
      datasets: qcDatasets
    },
    options:{
      responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{position:'top',labels:{usePointStyle:true,boxWidth:8,font:{size:11,family:'Inter'}}},
        avgLinePlugin:{enabled:state.showAvgLine,value:avgY1,scaleID:'y',color:'rgba(37,99,235,0.5)',label:'μ 均值'}
      },
      scales:{
        x:{grid:{display:false},ticks:{font:{size:10,family:'Inter'},maxTicksLimit:15}},
        y:{beginAtZero:true,grid:{color:'#f0f0f0'},ticks:{font:{size:10,family:'Inter'},callback:v=>moneyFmt(v)}},
        y1:{beginAtZero:true,position:'right',grid:{display:false},ticks:{font:{size:10,family:'Inter'},callback:v=>isPct?v+'%':(roiKeys.includes(y2Key)?v+'x':v)}}
      }
    }
  });
}

function renderQcRoiChart(data){
  if(!data.length){document.getElementById('qcRoiChart').parentElement.innerHTML='<div class="empty-state"><p>暂无数据</p></div>';return;}
  const map={};
  data.forEach(d=>{
    if(!map[d.date]) map[d.date]={liveRoi:0,directRoi:0,materialRoi:0,mallRoi:0,count:0};
    map[d.date].liveRoi+=d.livePromoRoi||0; map[d.date].directRoi+=d.directRoi||0;
    map[d.date].materialRoi+=d.materialRoi||0; map[d.date].mallRoi+=d.mallPromoRoi||0; map[d.date].count++;
  });
  const sorted = Object.keys(map).sort();
  const labels = sorted;
  const liveRoi = sorted.map(k=>map[k].count?(map[k].liveRoi/map[k].count).toFixed(2):0);
  const directRoi = sorted.map(k=>map[k].count?(map[k].directRoi/map[k].count).toFixed(2):0);
  const materialRoi = sorted.map(k=>map[k].count?(map[k].materialRoi/map[k].count).toFixed(2):0);
  const mallRoi = sorted.map(k=>map[k].count?(map[k].mallRoi/map[k].count).toFixed(2):0);
  if(charts.qcRoi){charts.qcRoi.destroy()}
  const ctx = document.getElementById('qcRoiChart').getContext('2d');
  charts.qcRoi = new Chart(ctx,{
    type:'line',data:{
      labels,
      datasets:[
        {label:'直播推广ROI',data:liveRoi,borderColor:'#c9a962',backgroundColor:'rgba(201,169,98,0.08)',fill:true,tension:0.3,pointRadius:3},
        {label:'直投ROI',data:directRoi,borderColor:'#4a9e8e',backgroundColor:'rgba(74,158,142,0.08)',fill:true,tension:0.3,pointRadius:3,borderDash:[5,5]},
        {label:'素材ROI',data:materialRoi,borderColor:'#e07b4a',backgroundColor:'rgba(224,123,74,0.08)',fill:true,tension:0.3,pointRadius:3,borderDash:[3,3]},
        {label:'商城推广ROI',data:mallRoi,borderColor:'#2563eb',backgroundColor:'rgba(37,99,235,0.08)',fill:true,tension:0.3,pointRadius:3,borderDash:[2,4]}
      ]
    },
    options:{
      responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend:{position:'top',labels:{usePointStyle:true,boxWidth:8,font:{size:11,family:'Inter'}}}},
      scales:{
        x:{grid:{display:false},ticks:{font:{size:10,family:'Inter'},maxTicksLimit:15}},
        y:{beginAtZero:true,grid:{color:'#f0f0f0'},ticks:{font:{size:10,family:'Inter'},callback:v=>v+'x'}}
      }
    }
  });
}

function renderQcRank(data){
  // 数据源无计划级明细，按日期聚合后按消耗降序排名
  const map={};
  data.forEach(d=>{
    if(!map[d.date]) map[d.date]={date:d.date,totalSpend:0,promoGmv:0,promoRoi:0,count:0};
    const a=map[d.date]; a.totalSpend+=d.totalSpend||0; a.promoGmv+=d.promoGmv||0;
    a.promoRoi+=d.promoRoi||0; a.count++;
  });
  const ranked = Object.values(map).sort((a,b)=>b.totalSpend-a.totalSpend);
  const maxSpend = ranked.length?ranked[0].totalSpend:1;
  let html='<thead><tr><th>排名</th><th>日期</th><th class="num">消耗</th><th class="num">推广GMV</th><th class="num">推广ROI</th><th class="num">消耗占比</th></tr></thead><tbody>';
  ranked.forEach((a,i)=>{
    const pct = (a.totalSpend/maxSpend*100).toFixed(0);
    const avgRoi = a.count?(a.promoRoi/a.count).toFixed(2):0;
    const totalTotal = ranked.reduce((s,r)=>s+r.totalSpend,0);
    const spendShare = totalTotal?+(a.totalSpend/totalTotal*100).toFixed(2):0;
    let rankClass = i===0?'gold':i===1?'silver':i===2?'bronze':'';
    html+=`<tr><td><span class="rank-badge ${rankClass}">${i+1}</span></td>
      <td style="font-weight:600">${a.date}</td>
      <td class="num">${moneyFmt(a.totalSpend)}</td>
      <td class="num">${moneyFmt(a.promoGmv)}</td>
      <td class="num">${avgRoi}x</td>
      <td class="num">${spendShare}% <div class="prog-bar"><div class="fill ${pct>80?'high':''}" style="width:${Math.min(pct,100)}%"></div></div></td></tr>`;
  });
  html+='</tbody>';
  document.getElementById('qcRankTable').innerHTML = html;
}

function renderQcTable(data){
  const show = state.showTable;
  document.getElementById('qcTableCard').style.display = show?'block':'none';
  if(!show) return;
  const total = data.length;
  const pg = state.qcPage;
  const sz = state.pageSize;
  const pages = Math.ceil(total/sz)||1;
  const start = (pg-1)*sz;
  const pageData = data.slice(start,start+sz);
  document.getElementById('qcTableInfo').textContent = `共 ${total} 条`;
  if(!total){document.getElementById('qcTableWrap').innerHTML='<div class="empty-state"><p>暂无推广数据</p></div>';return;}
  let html = '<table><thead><tr><th>日期</th><th>店铺</th><th class="num">总消耗</th><th class="num">推广GMV</th><th class="num">推广ROI</th><th class="num">直播消耗</th><th class="num">直播ROI</th><th class="num">直投消耗</th><th class="num">直投ROI</th><th class="num">素材ROI</th></tr></thead><tbody>';
  pageData.forEach(d=>{
    html+=`<tr><td>${d.date}</td><td>${SHOP_NAMES[d.shop]}</td>
      <td class="num">${moneyFmt(d.totalSpend||0)}</td><td class="num">${moneyFmt(d.promoGmv||0)}</td>
      <td class="num">${(d.promoRoi||0).toFixed(2)}x</td>
      <td class="num">${moneyFmt(d.liveSpend||0)}</td><td class="num">${(d.livePromoRoi||0).toFixed(2)}x</td>
      <td class="num">${moneyFmt(d.directSpend||0)}</td><td class="num">${(d.directRoi||0).toFixed(2)}x</td>
      <td class="num">${(d.materialRoi||0).toFixed(2)}x</td></tr>`;
  });
  html+='</tbody></table>';
  document.getElementById('qcTableWrap').innerHTML = html;
}

// ============================================================
//  Collapsible cards
// ============================================================
function toggleCollapse(btn){
  const card = btn.closest('.card');
  if(card) card.classList.toggle('collapsed');
}

// ============================================================
//  11. INIT
// ============================================================
document.addEventListener('DOMContentLoaded',()=>{
  setTimeout(()=>{try{lucide.createIcons()}catch(e){}},50);
  initShopKpiPanel();
  initSsKpiPanel();
  initQcKpiPanel();
  renderOverviewTab();
});
