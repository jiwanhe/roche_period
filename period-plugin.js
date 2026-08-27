/**
 * 健康日曆 — Roche Plugin v3
 * 月經週期 + 體重/BMI 追蹤，同步健康狀況給 char
 */
(function(){
'use strict';
const app={
  id:'health-cal',name:'健康日曆',icon:'favorite',iconImage:'',

  async mount(container,roche){
    const PK='#FF6B81',PKL='#FFF0F3',PKD='#E84565',BG='#fff',T1='#222',T2='#666',T3='#999',BD='#F0F0F0';
    const OV='#9B59B6',LU='#F39C12',FO='#3498DB',PRED='#FFB6C1';
    const WT='#4ECDC4',WTL='#E8FBF9',WTD='#2FA89E'; // 體重用青色系
    const DAYS=['日','一','二','三','四','五','六'];
    const MONTHS=['一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月'];

    const DEFAULT_PERIODS=[
      {start:'2025-08-28',days:7},{start:'2025-09-26',days:7},{start:'2025-10-23',days:9},
      {start:'2025-11-22',days:7},{start:'2025-12-24',days:7},{start:'2026-01-21',days:7},
      {start:'2026-02-17',days:7},{start:'2026-03-17',days:6},{start:'2026-04-13',days:6},
      {start:'2026-05-13',days:7},{start:'2026-06-11',days:6},{start:'2026-07-12',days:7},
      {start:'2026-08-09',days:7},
    ];

    // ── State ──
    const S={
      tab:'period', // period | weight
      showSettings:false,
      cfg:{charId:'',charName:'',convId:'',userName:'',autoSync:true,heightCm:''},
      periods:[],
      weights:[], // [{date:'2026-08-26',kg:52.3}]
      viewYear:new Date().getFullYear(),
      viewMonth:new Date().getMonth(),
      charList:[],convList:[],
      syncMsg:'',syncErr:false,
      editingPeriod:null,
      editingWeight:false,
    };

    // ── Storage ──
    const load=async k=>{try{const s=await roche.storage.get(k);return s?JSON.parse(s):null}catch(_){return null}};
    const sv=async(k,v)=>{try{await roche.storage.set(k,JSON.stringify(v))}catch(_){}};
    Object.assign(S.cfg,(await load('hc_cfg'))||{});
    S.periods=(await load('hc_periods'))||(await load('pc2_periods'))||[]; // 兼容舊版key
    if(!S.periods.length)S.periods=[...DEFAULT_PERIODS];
    S.weights=(await load('hc_weights'))||[];
    const saveCfg=()=>sv('hc_cfg',S.cfg);
    const savePeriods=()=>sv('hc_periods',S.periods);
    const saveWeights=()=>sv('hc_weights',S.weights);

    try{S.charList=await roche.character.list()||[]}catch(_){}
    try{S.convList=await roche.conversation.list()||[]}catch(_){}
    if(!S.cfg.userName){try{const u=await roche.persona.getActiveUserPersona();if(u)S.cfg.userName=u.name||u.handle||'';}catch(_){}}
    if(!S.cfg.charId&&S.charList.length){S.cfg.charId=S.charList[0].id;S.cfg.charName=S.charList[0].name}
    if(!S.cfg.convId&&S.convList.length){
      const match=S.convList.find(c=>c.contactId===S.cfg.charId||c.name===S.cfg.charName);
      S.cfg.convId=(match||S.convList[0]).conversationId||(match||S.convList[0]).id;
    }

    // ── 日期工具 ──
    function ds(d){return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
    function pd(s){const[y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d)}
    function addDays(d,n){const r=new Date(d);r.setDate(r.getDate()+n);return r}
    function toRocheUTC(d){const dt=d instanceof Date?d:new Date(d);return`${dt.getUTCFullYear()}-${String(dt.getUTCMonth()+1).padStart(2,'0')}-${String(dt.getUTCDate()).padStart(2,'0')} ${String(dt.getUTCHours()).padStart(2,'0')}:${String(dt.getUTCMinutes()).padStart(2,'0')} UTC`}
    function diffDays(a,b){return Math.round((b-a)/86400000)}

    // ── 週期推算 ──
    function getSortedPeriods(){return[...S.periods].sort((a,b)=>a.start.localeCompare(b.start))}
    function calcCycleLengths(){
      const sorted=getSortedPeriods();const lengths=[];
      for(let i=1;i<sorted.length;i++){const gap=diffDays(pd(sorted[i-1].start),pd(sorted[i].start));if(gap>15&&gap<50)lengths.push(gap);}
      return lengths;
    }
    function getAvgCycleLen(){
      const lens=calcCycleLengths();if(!lens.length)return 28;
      const recent=lens.slice(-6);const w=recent.map((_,i)=>i+1);
      const sum=recent.reduce((s,v,i)=>s+v*w[i],0);const wSum=w.reduce((s,v)=>s+v,0);
      return Math.round(sum/wSum);
    }
    function getAvgPeriodDays(){
      const sorted=getSortedPeriods();if(!sorted.length)return 7;
      const recent=sorted.slice(-6);
      return Math.round(recent.reduce((s,p)=>s+(p.days||7),0)/recent.length);
    }
    function getLastPeriod(){const s=getSortedPeriods();return s.length?s[s.length-1]:null}
    function predictNext(n=3){
      const last=getLastPeriod();if(!last)return[];
      const avgCycle=getAvgCycleLen(),avgDays=getAvgPeriodDays();
      const preds=[];let ref=pd(last.start);
      for(let i=0;i<n;i++){ref=addDays(ref,avgCycle);preds.push({start:ds(ref),days:avgDays,predicted:true});}
      return preds;
    }
    function getCycleInfo(){
      const last=getLastPeriod();if(!last)return null;
      const today=new Date(),lastDate=pd(last.start);
      const daysSince=diffDays(lastDate,today);
      const avgCycle=getAvgCycleLen(),avgDays=getAvgPeriodDays();
      const dayInCycle=daysSince+1;
      const preds=predictNext(1);
      const nextStart=preds.length?pd(preds[0].start):addDays(lastDate,avgCycle);
      const daysUntilNext=diffDays(today,nextStart);
      let phase,phaseColor;
      if(dayInCycle<=last.days){phase='月經期';phaseColor=PK;}
      else if(dayInCycle<=avgCycle-14){phase='卵泡期';phaseColor=FO;}
      else if(dayInCycle<=avgCycle-11){phase='排卵期';phaseColor=OV;}
      else{phase='黃體期';phaseColor=LU;}
      const isPMS=daysUntilNext<=5&&daysUntilNext>0&&phase==='黃體期';
      return{dayInCycle,phase,phaseColor,daysUntilNext,nextStart,isPMS,lastStart:last,avgCycle,avgDays};
    }
    function getDayStatus(date){
      const sorted=getSortedPeriods(),preds=predictNext(3);
      for(const p of sorted){const start=pd(p.start),end=addDays(start,(p.days||7)-1);if(date>=start&&date<=end)return{type:'period',color:PK};}
      for(const p of preds){const start=pd(p.start),end=addDays(start,(p.days||7)-1);if(date>=start&&date<=end)return{type:'predicted',color:PRED};}
      if(!sorted.length)return null;
      const last=sorted[sorted.length-1],lastDate=pd(last.start),avgCycle=getAvgCycleLen();
      const daysSince=diffDays(lastDate,date);if(daysSince<0)return null;
      const dayInCycle=((daysSince%avgCycle)+avgCycle)%avgCycle+1;
      if(dayInCycle<=(last.days||7))return{type:'period',color:PK};
      if(dayInCycle<=avgCycle-14)return{type:'follicular',color:FO};
      if(dayInCycle<=avgCycle-11)return{type:'ovulation',color:OV};
      return{type:'luteal',color:LU};
    }

    // ── 體重 / BMI ──
    function getSortedWeights(){return[...S.weights].sort((a,b)=>(a.utcTime||a.date).localeCompare(b.utcTime||b.date))}
    function getLatestWeight(){const s=getSortedWeights();return s.length?s[s.length-1]:null}
    function calcBMI(kg){
      const h=parseFloat(S.cfg.heightCm);
      if(!h||!kg)return null;
      const m=h/100;
      return kg/(m*m);
    }
    function bmiCategory(bmi){
      if(bmi==null)return{label:'--',color:T3};
      if(bmi<18.5)return{label:'體重過輕',color:FO};
      if(bmi<24)return{label:'正常範圍',color:'#2ECC71'};
      if(bmi<27)return{label:'體重過重',color:LU};
      return{label:'肥胖',color:'#E74C3C'};
    }
    function getWeightTrend(){
      const s=getSortedWeights();
      if(s.length<2)return null;
      const recent=s.slice(-7);
      const diff=recent[recent.length-1].kg-recent[0].kg;
      return diff;
    }
    function getWeightStats(){
      const s=getSortedWeights();
      if(!s.length)return null;
      const kgs=s.map(w=>w.kg);
      return{
        latest:s[s.length-1],
        min:Math.min(...kgs),max:Math.max(...kgs),
        avg7:s.slice(-7).reduce((sum,w)=>sum+w.kg,0)/Math.min(7,s.length),
        trend:getWeightTrend(),
        count:s.length,
      };
    }

    // ── 同步文字（合併週期+體重）──
    function buildSyncText(){
      const info=getCycleInfo();
      const wStats=getWeightStats();
      if(!info&&!wStats)return null;
      const today=ds(new Date());
      let t=`[健康狀態同步 ${today}]\n`;
      if(info){
        const lens=calcCycleLengths();
        const range=lens.length?`${Math.min(...lens)}-${Math.max(...lens)}天`:`${info.avgCycle}天`;
        t+=`\n【月經週期】\n目前階段：${info.phase}（週期第${info.dayInCycle}天）\n下次預計：${ds(info.nextStart)}（還有${info.daysUntilNext}天）\n週期範圍：${range}（平均${info.avgCycle}天）\n`;
        if(info.phase==='月經期')t+=`狀態：正在生理期中，可能經痛、疲倦、情緒低落，請溫柔對待。\n`;
        else if(info.isPMS)t+=`狀態：經前期PMS，可能情緒波動、易怒、疲倦，請多包容。\n`;
        else if(info.phase==='排卵期')t+=`狀態：排卵期，精力較好，心情通常不錯。\n`;
      }
      if(wStats){
        const bmi=calcBMI(wStats.latest.kg);
        const cat=bmiCategory(bmi);
        const utcStr=wStats.latest.utcTime?toRocheUTC(wStats.latest.utcTime):wStats.latest.date;
        t+=`\n【體重狀況】\n最新體重：${wStats.latest.kg}kg（測量時間：${utcStr}）\n`;
        if(bmi)t+=`BMI：${bmi.toFixed(1)}（${cat.label}）\n`;
        if(wStats.trend!=null){
          const dir=wStats.trend>0?'增加':wStats.trend<0?'減少':'持平';
          t+=`近7天變化：${dir} ${Math.abs(wStats.trend).toFixed(1)}kg\n`;
        }
      }
      return t;
    }

    async function syncToMemory(){
      const text=buildSyncText();
      if(!text){S.syncMsg='請先新增記錄';S.syncErr=true;render();return;}
      const convId=S.cfg.convId;
      if(!convId){S.syncMsg='請到設定選擇對話';S.syncErr=true;render();return;}
      try{
        await roche.memory.write({
          conversationId:convId,summaryText:text,
          who:[S.cfg.userName||'用戶',S.cfg.charName||'角色'],
          action:text,when:toRocheUTC(new Date())+' -> '+toRocheUTC(new Date()),where:'健康日曆同步',
          source:'plugin:health-calendar'
        });
        S.syncMsg='✅ 已同步到「'+S.cfg.charName+'」的記憶';S.syncErr=false;
        toast('✨ 已同步');
      }catch(e){S.syncMsg='同步失敗：'+e.message;S.syncErr=true;}
      render();
    }

    // ── Style ──
    const style=document.createElement('style');
    style.textContent=`
      .pc{width:100%;height:100%;position:relative;overflow:hidden;font-family:-apple-system,"PingFang SC","Helvetica Neue",sans-serif;background:${BG};display:flex;flex-direction:column;color:${T1}}
      .pc *{box-sizing:border-box}
      .pc-hdr{height:50px;display:flex;align-items:center;justify-content:space-between;padding:0 14px;border-bottom:1px solid ${BD};flex-shrink:0}
      .pc-hdr-btn{width:34px;height:34px;display:flex;align-items:center;justify-content:center;background:none;border:none;border-radius:50%;cursor:pointer;color:${T1}}
      .pc-tabs2{display:flex;border-bottom:1px solid ${BD};flex-shrink:0}
      .pc-tab2{flex:1;text-align:center;padding:11px 0;font-size:14px;font-weight:600;cursor:pointer;color:${T3};position:relative}
      .pc-tab2.on{color:${T1}}
      .pc-tab2.on::after{content:'';position:absolute;bottom:0;left:0;right:0;height:2.5px}
      .pc-tab2.on[data-t="period"]::after{background:${PK}}
      .pc-tab2.on[data-t="weight"]::after{background:${WT}}
      .pc-body{flex:1;overflow-y:auto;padding-bottom:20px}
      .pc-status{margin:14px;border-radius:16px;padding:18px;color:#fff;position:relative;overflow:hidden}
      .pc-status-phase{font-size:22px;font-weight:800}
      .pc-status-detail{font-size:13px;margin-top:6px;opacity:.9;line-height:1.6}
      .pc-status-day{position:absolute;right:18px;top:14px;font-size:44px;font-weight:900;opacity:.15}
      .pc-stats{display:flex;gap:8px;margin:0 14px 14px;flex-wrap:wrap}
      .pc-stat{flex:1;min-width:76px;background:#f8f8f8;border-radius:12px;padding:10px;text-align:center}
      .pc-stat .v{font-size:19px;font-weight:800;color:${T1}}
      .pc-stat .l{font-size:10px;color:${T3};margin-top:2px}
      .pc-cal{margin:0 14px}
      .pc-cal-hdr{display:flex;align-items:center;justify-content:space-between;padding:8px 0}
      .pc-cal-hdr span{font-weight:700;font-size:15px}
      .pc-cal-hdr button{background:none;border:none;font-size:18px;cursor:pointer;color:${T1};padding:4px 10px}
      .pc-cal-days{display:grid;grid-template-columns:repeat(7,1fr);text-align:center;font-size:12px;color:${T3};padding:4px 0}
      .pc-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px}
      .pc-cal-cell{aspect-ratio:1;display:flex;flex-direction:column;align-items:center;justify-content:center;border-radius:50%;cursor:pointer;font-size:14px;position:relative}
      .pc-cal-cell:hover{background:#f5f5f5}
      .pc-cal-cell.today{font-weight:800}
      .pc-cal-cell.today::after{content:'';position:absolute;bottom:2px;width:4px;height:4px;border-radius:50%;background:${PK}}
      .pc-cal-cell.period{background:${PK};color:#fff;font-weight:700}
      .pc-cal-cell.predicted{background:${PRED};color:#fff;font-weight:600}
      .pc-cal-cell .dot{width:5px;height:5px;border-radius:50%;position:absolute;bottom:3px}
      .pc-cal-cell.empty{cursor:default}.pc-cal-cell.empty:hover{background:transparent}
      .pc-legend{display:flex;gap:10px;justify-content:center;margin:10px 14px;flex-wrap:wrap}
      .pc-legend-item{display:flex;align-items:center;gap:4px;font-size:11px;color:${T2}}
      .pc-legend-dot{width:10px;height:10px;border-radius:50%}
      .pc-history{margin:14px}
      .pc-history-title{font-weight:700;font-size:14px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center}
      .pc-history-item{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:1px solid ${BD};font-size:13px}
      .pc-history-item:last-child{border-bottom:none}
      .pc-history-date{font-weight:600}
      .pc-history-info{color:${T3};font-size:12px}
      .pc-history-del{background:none;border:none;color:${T3};cursor:pointer;font-size:16px;padding:4px 8px}
      .pc-sync{margin:14px;padding:14px;border-radius:12px;background:#f8f8f8;border:1px solid ${BD}}
      .pc-sync-btn{width:100%;padding:12px;border-radius:12px;color:#fff;border:none;font-weight:700;font-size:14px;cursor:pointer;margin-top:8px}
      .pc-sync-preview{font-size:11px;color:${T2};background:#fff;border:1px solid ${BD};border-radius:8px;padding:10px;margin-top:8px;white-space:pre-wrap;line-height:1.5;font-family:monospace}
      .pc-add-btn{display:flex;align-items:center;justify-content:center;gap:6px;padding:6px 14px;border-radius:12px;font-weight:600;font-size:12px;cursor:pointer;border:1px solid}
      .pc-mask{position:absolute;inset:0;z-index:200;background:rgba(0,0,0,.45);display:flex;align-items:flex-end}
      .pc-set{width:100%;background:#fff;border-radius:16px 16px 0 0;padding:18px;max-height:80%;overflow-y:auto}
      .pc-sl{display:block;font-size:12px;font-weight:600;color:${T2};margin:10px 0 4px}
      .pc-si{width:100%;padding:9px 12px;border-radius:10px;border:1px solid ${BD};font-size:13px;outline:none;background:#FAFAFA;font-family:inherit}
      .pc-sbtn{width:100%;padding:11px 0;border-radius:24px;color:#fff;border:none;font-weight:700;font-size:14px;margin-top:14px;cursor:pointer}
      .pc-toast{position:absolute;top:60px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.7);color:#fff;padding:8px 18px;border-radius:20px;font-size:13px;z-index:300;pointer-events:none;animation:pf .3s}
      .pc-chart{margin:14px;padding:16px;background:#f8f8f8;border-radius:14px}
      .pc-chart-title{font-weight:700;font-size:14px;margin-bottom:10px}
      .pc-bmi-bar{height:8px;border-radius:4px;background:linear-gradient(90deg,${FO} 0%,${FO} 20%,#2ECC71 20%,#2ECC71 45%,${LU} 45%,${LU} 60%,#E74C3C 60%,#E74C3C 100%);position:relative;margin:10px 0}
      .pc-bmi-marker{position:absolute;top:-4px;width:2px;height:16px;background:${T1};border-radius:1px}
      @keyframes pf{from{opacity:0;transform:translateX(-50%) translateY(-8px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
    `;
    container.appendChild(style);

    function esc(s){return s?String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'):''}
    function toast(m){const t=document.createElement('div');t.className='pc-toast';t.textContent=m;root.appendChild(t);setTimeout(()=>t.remove(),2500)}

    // ── SVG 折線圖 ──
    function weightChartSVG(){
      const s=getSortedWeights().slice(-30); // 最近30筆
      if(s.length<2)return `<div style="text-align:center;padding:30px;color:${T3};font-size:13px">記錄至少2筆才能看趨勢圖</div>`;
      const w=300,h=120,pad=24;
      const kgs=s.map(x=>x.kg);
      const min=Math.min(...kgs)-0.5,max=Math.max(...kgs)+0.5;
      const range=max-min||1;
      const stepX=(w-pad*2)/(s.length-1);
      const pts=s.map((d,i)=>{
        const x=pad+i*stepX;
        const y=pad+(1-(d.kg-min)/range)*(h-pad*1.5);
        return{x,y,kg:d.kg,date:d.date};
      });
      const pathD=pts.map((p,i)=>(i===0?'M':'L')+p.x.toFixed(1)+','+p.y.toFixed(1)).join(' ');
      const areaD=pathD+` L${pts[pts.length-1].x.toFixed(1)},${h-pad*0.5} L${pts[0].x.toFixed(1)},${h-pad*0.5} Z`;
      let svg=`<svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" style="overflow:visible">`;
      svg+=`<defs><linearGradient id="wgrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${WT}" stop-opacity="0.3"/><stop offset="100%" stop-color="${WT}" stop-opacity="0"/></linearGradient></defs>`;
      svg+=`<path d="${areaD}" fill="url(#wgrad)"/>`;
      svg+=`<path d="${pathD}" fill="none" stroke="${WT}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
      pts.forEach((p,i)=>{
        if(i===pts.length-1||i===0||i%Math.ceil(pts.length/5)===0){
          svg+=`<circle cx="${p.x}" cy="${p.y}" r="3" fill="${WT}"/>`;
        }
      });
      // 最新值標籤
      const last=pts[pts.length-1];
      svg+=`<text x="${last.x}" y="${last.y-10}" font-size="11" fill="${WTD}" font-weight="700" text-anchor="middle">${last.kg}kg</text>`;
      svg+=`</svg>`;
      return svg;
    }

    // ── Render ──
    const root=document.createElement('div');root.className='pc';container.appendChild(root);
    function render(){
      let h='';
      h+=`<div class="pc-hdr"><button class="pc-hdr-btn" data-a="exit"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg></button><span style="font-weight:800;font-size:17px">💗 健康日曆</span><button class="pc-hdr-btn" data-a="settings"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${T2}" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></button></div>`;
      h+=`<div class="pc-tabs2"><div class="pc-tab2 ${S.tab==='period'?'on':''}" data-t="period" data-a="switch-tab">🩸 月經週期</div><div class="pc-tab2 ${S.tab==='weight'?'on':''}" data-t="weight" data-a="switch-tab">⚖️ 體重 BMI</div></div>`;
      h+=`<div class="pc-body">${S.tab==='period'?vPeriodTab():vWeightTab()}</div>`;
      if(S.showSettings)h+=vSettings();
      if(S.editingPeriod!==null)h+=vEditPeriod();
      if(S.editingWeight)h+=vEditWeight();
      root.innerHTML=h;
    }

    // ═══ 月經頁 ═══
    function vPeriodTab(){
      let h='';
      const info=getCycleInfo();
      if(info){
        h+=`<div class="pc-status" style="background:linear-gradient(135deg,${info.phaseColor},${info.phaseColor}cc)"><div class="pc-status-phase">${info.phase}</div><div class="pc-status-detail">週期第 ${info.dayInCycle} 天<br>下次月經：${ds(info.nextStart)}（${info.daysUntilNext>0?'還有 '+info.daysUntilNext+' 天':'就是今天！'})${info.isPMS?'<br>⚠️ 經前期 PMS':''}</div><div class="pc-status-day">D${info.dayInCycle}</div></div>`;
        const lens=calcCycleLengths();
        h+=`<div class="pc-stats"><div class="pc-stat"><div class="v">${info.avgCycle}</div><div class="l">平均週期</div></div><div class="pc-stat"><div class="v">${info.avgDays}</div><div class="l">平均經期</div></div><div class="pc-stat"><div class="v">${lens.length?Math.min(...lens)+'-'+Math.max(...lens):'--'}</div><div class="l">週期範圍</div></div><div class="pc-stat"><div class="v">${S.periods.length}</div><div class="l">記錄筆數</div></div></div>`;
      }else{
        h+=`<div class="pc-status" style="background:linear-gradient(135deg,${T3},${T3}cc)"><div class="pc-status-phase">尚未記錄</div><div class="pc-status-detail">請新增月經記錄</div></div>`;
      }
      h+=vCalendar();
      h+=`<div class="pc-legend"><div class="pc-legend-item"><div class="pc-legend-dot" style="background:${PK}"></div>月經期</div><div class="pc-legend-item"><div class="pc-legend-dot" style="background:${PRED}"></div>預測</div><div class="pc-legend-item"><div class="pc-legend-dot" style="background:${FO}"></div>卵泡期</div><div class="pc-legend-item"><div class="pc-legend-dot" style="background:${OV}"></div>排卵期</div><div class="pc-legend-item"><div class="pc-legend-dot" style="background:${LU}"></div>黃體期</div></div>`;
      h+=vPeriodHistory();
      h+=vSyncBox();
      return h;
    }

    function vCalendar(){
      const y=S.viewYear,m=S.viewMonth;
      const firstDay=new Date(y,m,1).getDay();
      const dim=new Date(y,m+1,0).getDate();
      const today=new Date();const todayStr=ds(today);
      let h=`<div class="pc-cal"><div class="pc-cal-hdr"><button data-a="prev-month">◀</button><span>${y}年 ${MONTHS[m]}</span><button data-a="next-month">▶</button></div>`;
      h+=`<div class="pc-cal-days">${DAYS.map(d=>`<span>${d}</span>`).join('')}</div><div class="pc-cal-grid">`;
      for(let i=0;i<firstDay;i++)h+=`<div class="pc-cal-cell empty"></div>`;
      for(let d=1;d<=dim;d++){
        const date=new Date(y,m,d);const dateS=ds(date);
        const isToday=dateS===todayStr;
        const status=getDayStatus(date);
        let cls='pc-cal-cell';
        if(isToday)cls+=' today';
        if(status?.type==='period')cls+=' period';else if(status?.type==='predicted')cls+=' predicted';
        h+=`<div class="${cls}" data-a="tap-date" data-d="${dateS}"><span>${d}</span>`;
        if(status&&status.type!=='period'&&status.type!=='predicted')h+=`<div class="dot" style="background:${status.color}"></div>`;
        h+=`</div>`;
      }
      h+=`</div></div>`;
      return h;
    }

    function vPeriodHistory(){
      const sorted=getSortedPeriods().reverse();
      const lens=calcCycleLengths().reverse();
      let h=`<div class="pc-history"><div class="pc-history-title"><span>📋 月經記錄</span><button class="pc-add-btn" data-a="add-period" style="background:${PKL};color:${PK};border-color:${PK}30">+ 新增</button></div>`;
      h+=`<div style="background:#f8f8f8;border-radius:12px;overflow:hidden">`;
      sorted.forEach((p)=>{
        const idx=S.periods.indexOf(p);
        const i=sorted.indexOf(p);
        const cycleLen=i<lens.length?lens[i]:null;
        h+=`<div class="pc-history-item"><div><div class="pc-history-date">${p.start}</div><div class="pc-history-info">經期 ${p.days} 天${cycleLen?' · 週期 '+cycleLen+' 天':''}</div></div><div style="display:flex;gap:4px"><button class="pc-history-del" data-a="edit-period" data-idx="${idx}">✏️</button><button class="pc-history-del" data-a="del-period" data-idx="${idx}">✕</button></div></div>`;
      });
      if(!sorted.length)h+=`<div style="padding:20px;text-align:center;color:${T3}">還沒有記錄</div>`;
      h+=`</div></div>`;
      return h;
    }

    // ═══ 體重頁 ═══
    function vWeightTab(){
      let h='';
      const wStats=getWeightStats();
      const latest=wStats?.latest;
      const bmi=latest?calcBMI(latest.kg):null;
      const cat=bmiCategory(bmi);

      if(latest){
        h+=`<div class="pc-status" style="background:linear-gradient(135deg,${WT},${WTD})"><div class="pc-status-phase">${latest.kg} kg</div><div class="pc-status-detail">${latest.date}${bmi?`<br>BMI ${bmi.toFixed(1)} · ${cat.label}`:'<br>設定身高即可計算 BMI'}${wStats.trend!=null?`<br>近7天：${wStats.trend>0?'↗':wStats.trend<0?'↘':'→'} ${Math.abs(wStats.trend).toFixed(1)}kg`:''}</div></div>`;
        h+=`<div class="pc-stats"><div class="pc-stat"><div class="v">${wStats.min.toFixed(1)}</div><div class="l">最低</div></div><div class="pc-stat"><div class="v">${wStats.max.toFixed(1)}</div><div class="l">最高</div></div><div class="pc-stat"><div class="v">${wStats.avg7.toFixed(1)}</div><div class="l">7天均值</div></div><div class="pc-stat"><div class="v">${wStats.count}</div><div class="l">記錄筆數</div></div></div>`;
      }else{
        h+=`<div class="pc-status" style="background:linear-gradient(135deg,${T3},${T3}cc)"><div class="pc-status-phase">尚未記錄</div><div class="pc-status-detail">點下方新增第一筆體重記錄</div></div>`;
      }

      // BMI bar
      if(bmi){
        const pct=Math.max(0,Math.min(100,((bmi-15)/(32-15))*100));
        h+=`<div class="pc-chart"><div class="pc-chart-title">BMI 指標</div><div class="pc-bmi-bar"><div class="pc-bmi-marker" style="left:${pct}%"></div></div><div style="display:flex;justify-content:space-between;font-size:10px;color:${T3}"><span>過輕</span><span>正常</span><span>過重</span><span>肥胖</span></div><div style="text-align:center;margin-top:8px;font-size:20px;font-weight:800;color:${cat.color}">${bmi.toFixed(1)}</div><div style="text-align:center;font-size:12px;color:${T2}">${cat.label}（身高 ${S.cfg.heightCm}cm）</div></div>`;
      }else if(!S.cfg.heightCm){
        h+=`<div style="margin:14px;padding:12px;background:#FFF8E8;border:1px solid #F0E0B0;border-radius:10px;font-size:12px;color:#996600">💡 到設定填入身高，即可自動計算 BMI</div>`;
      }

      // Chart
      h+=`<div class="pc-chart"><div class="pc-chart-title">體重趨勢（近30筆）</div>${weightChartSVG()}</div>`;

      // History
      h+=vWeightHistory();
      h+=vSyncBox();
      return h;
    }

    function vWeightHistory(){
      const sorted=getSortedWeights().reverse();
      let h=`<div class="pc-history"><div class="pc-history-title"><span>📋 體重記錄</span><button class="pc-add-btn" data-a="add-weight" style="background:${WTL};color:${WTD};border-color:${WT}30">+ 新增</button></div>`;
      h+=`<div style="background:#f8f8f8;border-radius:12px;overflow:hidden;max-height:280px;overflow-y:auto">`;
      sorted.slice(0,30).forEach((w)=>{
        const idx=S.weights.indexOf(w);
        const bmi=calcBMI(w.kg);
        const utcLabel=w.utcTime?toRocheUTC(w.utcTime).slice(11):'';
        h+=`<div class="pc-history-item"><div><div class="pc-history-date">${w.date} ${utcLabel?'<span style="font-weight:400;color:'+T3+';font-size:11px">'+utcLabel+'</span>':''}</div><div class="pc-history-info">${w.kg} kg${bmi?' · BMI '+bmi.toFixed(1):''}</div></div><button class="pc-history-del" data-a="del-weight" data-idx="${idx}">✕</button></div>`;
      });
      if(!sorted.length)h+=`<div style="padding:20px;text-align:center;color:${T3}">還沒有記錄</div>`;
      h+=`</div></div>`;
      return h;
    }

    function vSyncBox(){
      let h=`<div class="pc-sync"><div style="font-weight:700;font-size:14px;margin-bottom:4px">📤 同步給 ${esc(S.cfg.charName||'角色')}</div><div style="font-size:12px;color:${T3}">將健康狀態（週期+體重）寫入聊天記憶</div>`;
      const syncText=buildSyncText();
      if(syncText)h+=`<div class="pc-sync-preview">${esc(syncText)}</div>`;
      h+=`<button class="pc-sync-btn" data-a="sync" style="background:${PK}">🔄 同步到聊天記憶</button>`;
      if(S.syncMsg)h+=`<div style="font-size:12px;margin-top:8px;color:${S.syncErr?'#CC3333':'#2d8a5f'}">${esc(S.syncMsg)}</div>`;
      h+=`</div>`;
      return h;
    }

    function vEditPeriod(){
      const isNew=S.editingPeriod==='new';
      const p=isNew?{start:S._tapDate||ds(new Date()),days:7}:S.periods[S.editingPeriod];
      if(!p)return'';
      return`<div class="pc-mask"><div class="pc-set"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px"><span style="font-weight:700;font-size:15px">${isNew?'新增月經記錄':'編輯記錄'}</span><button data-a="close-edit" style="background:none;border:none;font-size:18px;color:${T3};cursor:pointer">✕</button></div><label class="pc-sl">月經開始日</label><input class="pc-si" type="date" data-f="edit-start" value="${p.start}"><label class="pc-sl">持續天數</label><input class="pc-si" type="number" data-f="edit-days" min="1" max="15" value="${p.days}"><button data-a="save-period" class="pc-sbtn" style="background:${PK}">${isNew?'新增':'儲存'}</button></div></div>`;
    }

    function vEditWeight(){
      const now=new Date();
      const hh=String(now.getHours()).padStart(2,'0'),mm=String(now.getMinutes()).padStart(2,'0');
      return`<div class="pc-mask"><div class="pc-set"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px"><span style="font-weight:700;font-size:15px">新增體重記錄</span><button data-a="close-edit-weight" style="background:none;border:none;font-size:18px;color:${T3};cursor:pointer">✕</button></div><label class="pc-sl">日期</label><input class="pc-si" type="date" data-f="w-date" value="${ds(now)}"><label class="pc-sl">時間（當地時間，會自動換算成 UTC 儲存）</label><input class="pc-si" type="time" data-f="w-time" value="${hh}:${mm}"><label class="pc-sl">體重（kg）</label><input class="pc-si" type="number" step="0.1" data-f="w-kg" placeholder="例如 52.3"><button data-a="save-weight" class="pc-sbtn" style="background:${WT}">新增</button></div></div>`;
    }

    function vSettings(){
      const c=S.cfg;
      let h=`<div class="pc-mask"><div class="pc-set"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px"><span style="font-weight:700;font-size:15px">設定</span><button data-a="close-set" style="background:none;border:none;font-size:18px;color:${T3};cursor:pointer">✕</button></div>`;
      h+=`<label class="pc-sl">身高（cm，用於計算 BMI）</label><input class="pc-si" data-f="heightCm" type="number" value="${esc(c.heightCm)}" placeholder="例如 160" style="width:120px">`;
      h+=`<label class="pc-sl">同步給誰？</label><select class="pc-si" data-f="charId">${S.charList.map(ch=>`<option value="${esc(ch.id)}" ${ch.id===c.charId?'selected':''}>${esc(ch.name||ch.handle)}</option>`).join('')}</select>`;
      h+=`<label class="pc-sl">寫入哪個對話？</label><select class="pc-si" data-f="convId">${S.convList.map(cv=>{const cid=cv.conversationId||cv.id;return`<option value="${esc(cid)}" ${cid===c.convId?'selected':''}>${esc(cv.name||cv.handle||cid)}</option>`}).join('')}</select>`;
      h+=`<label class="pc-sl">你的名字</label><input class="pc-si" data-f="userName" value="${esc(c.userName)}">`;
      h+=`<button data-a="save-set" class="pc-sbtn" style="background:${PK}">儲存設定</button>`;
      h+=`<button data-a="reset-data" class="pc-sbtn" style="background:#fff;color:${PK};border:1px solid ${PK};margin-top:8px">🗑️ 重置月經資料為預設值</button>`;
      h+=`</div></div>`;
      return h;
    }

    // ── Events ──
    function onClick(e){
      const b=e.target.closest('[data-a]');if(!b)return;
      const a=b.dataset.a;
      if(a==='exit')roche.ui?.closeApp?.();
      else if(a==='settings'){S.showSettings=true;render();}
      else if(a==='close-set'){S.showSettings=false;render();}
      else if(a==='close-edit'){S.editingPeriod=null;render();}
      else if(a==='close-edit-weight'){S.editingWeight=false;render();}
      else if(a==='switch-tab'){S.tab=b.dataset.t;render();}
      else if(a==='prev-month'){S.viewMonth--;if(S.viewMonth<0){S.viewMonth=11;S.viewYear--;}render();}
      else if(a==='next-month'){S.viewMonth++;if(S.viewMonth>11){S.viewMonth=0;S.viewYear++;}render();}
      else if(a==='tap-date'){
        const d=b.dataset.d;
        const existing=S.periods.findIndex(p=>p.start===d);
        S.editingPeriod=existing>=0?existing:'new';
        S._tapDate=d;render();
      }
      else if(a==='add-period'){S.editingPeriod='new';S._tapDate=ds(new Date());render();}
      else if(a==='edit-period'){S.editingPeriod=parseInt(b.dataset.idx);render();}
      else if(a==='del-period'){const idx=parseInt(b.dataset.idx);if(!isNaN(idx)){S.periods.splice(idx,1);savePeriods();toast('已刪除');render();}}
      else if(a==='save-period'){
        const start=root.querySelector('[data-f="edit-start"]')?.value||S._tapDate||ds(new Date());
        const days=parseInt(root.querySelector('[data-f="edit-days"]')?.value)||7;
        if(S.editingPeriod==='new'){
          if(!S.periods.find(p=>p.start===start)){S.periods.push({start,days});S.periods.sort((a,b)=>a.start.localeCompare(b.start));savePeriods();toast('已新增');}
          else toast('已存在該日期');
        }else{S.periods[S.editingPeriod]={start,days};S.periods.sort((a,b)=>a.start.localeCompare(b.start));savePeriods();toast('已更新');}
        S.editingPeriod=null;render();
      }
      else if(a==='add-weight'){S.editingWeight=true;render();}
      else if(a==='save-weight'){
        const dateVal=root.querySelector('[data-f="w-date"]')?.value;
        const timeVal=root.querySelector('[data-f="w-time"]')?.value||'00:00';
        const kg=parseFloat(root.querySelector('[data-f="w-kg"]')?.value);
        if(!dateVal||!kg||kg<=0){toast('請填寫完整資訊');return;}
        // 組成當地時間的 Date 物件，再轉成 UTC ISO 字串儲存
        const [y,mo,d]=dateVal.split('-').map(Number);
        const [hh,mi]=timeVal.split(':').map(Number);
        const localDt=new Date(y,mo-1,d,hh,mi);
        const utcIso=localDt.toISOString(); // 例如 2026-08-26T13:05:00.000Z
        const dateKey=ds(localDt); // 仍用當地日期當作分組/排序的 key
        const existing=S.weights.findIndex(w=>w.date===dateKey&&w.utcTime&&w.utcTime.slice(0,16)===utcIso.slice(0,16));
        if(existing>=0)S.weights[existing]={date:dateKey,kg,utcTime:utcIso};
        else S.weights.push({date:dateKey,kg,utcTime:utcIso});
        S.weights.sort((a,b)=>(a.utcTime||a.date).localeCompare(b.utcTime||b.date));
        saveWeights();S.editingWeight=false;toast('已記錄 '+kg+'kg');render();
      }
      else if(a==='del-weight'){const idx=parseInt(b.dataset.idx);if(!isNaN(idx)){S.weights.splice(idx,1);saveWeights();toast('已刪除');render();}}
      else if(a==='sync'){syncToMemory();}
      else if(a==='save-set'){
        root.querySelectorAll('[data-f]').forEach(el=>{S.cfg[el.dataset.f]=el.value;});
        const ch=S.charList.find(c=>c.id===S.cfg.charId);if(ch)S.cfg.charName=ch.name||ch.handle||'';
        saveCfg();S.showSettings=false;toast('已儲存');render();
      }
      else if(a==='reset-data'){S.periods=[...DEFAULT_PERIODS];savePeriods();S.showSettings=false;toast('已重置');render();}
    }
    root.addEventListener('click',onClick);
    render();
    if(S.cfg.autoSync&&(S.periods.length||S.weights.length)&&S.cfg.convId){setTimeout(()=>syncToMemory(),1500);}
    this._el=root;this._st=style;this._fn=onClick;
  },

  async unmount(container){
    if(this._el){this._el.removeEventListener('click',this._fn);this._el.remove();}
    if(this._st)this._st.remove();
    container.replaceChildren();
  }
};
window.RochePlugin.register({id:'roche-health-calendar',name:'健康日曆',version:'3.0.0',description:'同步月經週期與體重BMI給TA',author:'予佟',apps:[app]});
})();
