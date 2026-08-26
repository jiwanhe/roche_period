/**
 * 月經日曆 — Roche Plugin v2
 * 根據歷史記錄自動推算週期，同步狀態給 char
 */
(function(){
'use strict';
const app={
  id:'period-cal',name:'月經日曆',icon:'calendar_month',iconImage:'',

  async mount(container,roche){
    const PK='#FF6B81',PKL='#FFF0F3',PKD='#E84565',BG='#fff',T1='#222',T2='#666',T3='#999',BD='#F0F0F0';
    const OV='#9B59B6',OVL='#F3E8FF',LU='#F39C12',LUL='#FFF8E8',FO='#3498DB',FOL='#EBF5FF';
    const PRED='#FFB6C1'; // 預測期顏色（淡粉）
    const DAYS=['日','一','二','三','四','五','六'];
    const MONTHS=['一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月'];

    // 預設歷史記錄（予佟的實際數據）
    const DEFAULT_PERIODS=[
      {start:'2025-08-28',days:7},{start:'2025-09-26',days:7},{start:'2025-10-23',days:9},
      {start:'2025-11-22',days:7},{start:'2025-12-24',days:7},{start:'2026-01-21',days:7},
      {start:'2026-02-17',days:7},{start:'2026-03-17',days:6},{start:'2026-04-13',days:6},
      {start:'2026-05-13',days:7},{start:'2026-06-11',days:6},{start:'2026-07-12',days:7},
      {start:'2026-08-09',days:7},
    ];

    // ── State ──
    const S={
      showSettings:false,
      cfg:{charId:'',charName:'',convId:'',userName:'',autoSync:true},
      // 每次月經記錄 [{start:'2026-08-09',days:7}, ...]
      periods:[],
      viewYear:new Date().getFullYear(),
      viewMonth:new Date().getMonth(),
      charList:[],convList:[],
      syncMsg:'',syncErr:false,
      editingPeriod:null, // 正在編輯的經期（新增/修改天數）
    };

    // ── Storage ──
    const load=async k=>{try{const s=await roche.storage.get(k);return s?JSON.parse(s):null}catch(_){return null}};
    const sv=async(k,v)=>{try{await roche.storage.set(k,JSON.stringify(v))}catch(_){}};
    Object.assign(S.cfg,(await load('pc2_cfg'))||{});
    S.periods=(await load('pc2_periods'))||[];
    if(!S.periods.length)S.periods=[...DEFAULT_PERIODS]; // 首次用預設數據
    const saveCfg=()=>sv('pc2_cfg',S.cfg);
    const savePeriods=()=>sv('pc2_periods',S.periods);

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
    function diffDays(a,b){return Math.round((b-a)/86400000)}

    // ── 週期智慧推算 ──
    function getSortedPeriods(){return[...S.periods].sort((a,b)=>a.start.localeCompare(b.start))}

    function calcCycleLengths(){
      const sorted=getSortedPeriods();
      const lengths=[];
      for(let i=1;i<sorted.length;i++){
        const gap=diffDays(pd(sorted[i-1].start),pd(sorted[i].start));
        if(gap>15&&gap<50)lengths.push(gap); // 過濾異常值
      }
      return lengths;
    }

    function getAvgCycleLen(){
      const lens=calcCycleLengths();
      if(!lens.length)return 28;
      // 加權平均：近期權重更高
      const recent=lens.slice(-6); // 取最近6個週期
      const w=recent.map((_,i)=>i+1); // 權重 1,2,3,4,5,6
      const sum=recent.reduce((s,v,i)=>s+v*w[i],0);
      const wSum=w.reduce((s,v)=>s+v,0);
      return Math.round(sum/wSum);
    }

    function getAvgPeriodDays(){
      const sorted=getSortedPeriods();
      if(!sorted.length)return 7;
      const recent=sorted.slice(-6);
      const avg=recent.reduce((s,p)=>s+(p.days||7),0)/recent.length;
      return Math.round(avg);
    }

    function getLastPeriod(){
      const sorted=getSortedPeriods();
      return sorted.length?sorted[sorted.length-1]:null;
    }

    // 預測未來 N 次月經
    function predictNext(n=3){
      const last=getLastPeriod();
      if(!last)return[];
      const avgCycle=getAvgCycleLen();
      const avgDays=getAvgPeriodDays();
      const predictions=[];
      let ref=pd(last.start);
      for(let i=0;i<n;i++){
        ref=addDays(ref,avgCycle);
        predictions.push({start:ds(ref),days:avgDays,predicted:true});
      }
      return predictions;
    }

    function getCycleInfo(){
      const last=getLastPeriod();
      if(!last)return null;
      const today=new Date();
      const lastDate=pd(last.start);
      const daysSince=diffDays(lastDate,today);
      const avgCycle=getAvgCycleLen();
      const avgDays=getAvgPeriodDays();
      const dayInCycle=daysSince+1;

      // 下次預測
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

    // 判斷某天的狀態（日曆渲染用）
    function getDayStatus(date){
      const dateS=ds(date);
      const sorted=getSortedPeriods();
      const preds=predictNext(3);
      // 檢查是否在實際經期內
      for(const p of sorted){
        const start=pd(p.start);
        const end=addDays(start,(p.days||7)-1);
        if(date>=start&&date<=end)return{type:'period',color:PK};
      }
      // 檢查是否在預測經期內
      for(const p of preds){
        const start=pd(p.start);
        const end=addDays(start,(p.days||7)-1);
        if(date>=start&&date<=end)return{type:'predicted',color:PRED};
      }
      // 週期階段（根據最近的經期推算）
      if(!sorted.length)return null;
      const last=sorted[sorted.length-1];
      const lastDate=pd(last.start);
      const avgCycle=getAvgCycleLen();
      const daysSince=diffDays(lastDate,date);
      if(daysSince<0)return null;
      const dayInCycle=((daysSince%avgCycle)+avgCycle)%avgCycle+1;
      if(dayInCycle<=(last.days||7))return{type:'period',color:PK};
      if(dayInCycle<=avgCycle-14)return{type:'follicular',color:FO};
      if(dayInCycle<=avgCycle-11)return{type:'ovulation',color:OV};
      return{type:'luteal',color:LU};
    }

    // ── 同步文字 ──
    function buildSyncText(){
      const info=getCycleInfo();
      if(!info)return null;
      const today=ds(new Date());
      const lens=calcCycleLengths();
      const range=lens.length?`${Math.min(...lens)}-${Math.max(...lens)}天（平均${info.avgCycle}天）`:`${info.avgCycle}天`;
      let t=`[月經週期同步 ${today}]\n`;
      t+=`目前階段：${info.phase}（週期第${info.dayInCycle}天）\n`;
      t+=`上次月經：${info.lastStart.start}（持續${info.lastStart.days}天）\n`;
      t+=`下次預計：${ds(info.nextStart)}（還有${info.daysUntilNext}天）\n`;
      t+=`週期範圍：${range}　經期平均：${info.avgDays}天\n`;
      if(info.phase==='月經期')t+=`狀態：正在生理期中。可能經痛、疲倦、情緒低落。請溫柔對待。\n`;
      else if(info.isPMS)t+=`狀態：經前期 PMS。可能情緒波動、易怒、疲倦、腹脹。請多包容。\n`;
      else if(info.phase==='排卵期')t+=`狀態：排卵期，精力較好，心情通常不錯。\n`;
      else t+=`狀態：一般狀態。\n`;
      return t;
    }

    async function syncToMemory(){
      const text=buildSyncText();
      if(!text){S.syncMsg='請先新增至少一筆記錄';S.syncErr=true;render();return;}
      const convId=S.cfg.convId;
      if(!convId){S.syncMsg='請到設定選擇對話';S.syncErr=true;render();return;}
      try{
        await roche.memory.write({
          conversationId:convId,
          summaryText:text,
          who:[S.cfg.userName||'用戶',S.cfg.charName||'角色'],
          action:text,
          when:ds(new Date()),
          where:'月經日曆同步',
          source:'plugin:period-calendar'
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
      .pc-body{flex:1;overflow-y:auto;padding-bottom:20px}
      .pc-status{margin:14px;border-radius:16px;padding:18px;color:#fff;position:relative;overflow:hidden}
      .pc-status-phase{font-size:22px;font-weight:800}
      .pc-status-detail{font-size:13px;margin-top:6px;opacity:.9;line-height:1.6}
      .pc-status-day{position:absolute;right:18px;top:14px;font-size:44px;font-weight:900;opacity:.15}
      .pc-stats{display:flex;gap:8px;margin:0 14px 14px;flex-wrap:wrap}
      .pc-stat{flex:1;min-width:80px;background:#f8f8f8;border-radius:12px;padding:10px;text-align:center}
      .pc-stat .v{font-size:20px;font-weight:800;color:${T1}}
      .pc-stat .l{font-size:10px;color:${T3};margin-top:2px}
      .pc-cal{margin:0 14px}
      .pc-cal-hdr{display:flex;align-items:center;justify-content:space-between;padding:8px 0}
      .pc-cal-hdr span{font-weight:700;font-size:15px}
      .pc-cal-hdr button{background:none;border:none;font-size:18px;cursor:pointer;color:${T1};padding:4px 10px}
      .pc-cal-days{display:grid;grid-template-columns:repeat(7,1fr);text-align:center;font-size:12px;color:${T3};padding:4px 0}
      .pc-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px}
      .pc-cal-cell{aspect-ratio:1;display:flex;flex-direction:column;align-items:center;justify-content:center;border-radius:50%;cursor:pointer;font-size:14px;position:relative;transition:background .15s}
      .pc-cal-cell:hover{background:#f5f5f5}
      .pc-cal-cell.today{font-weight:800}
      .pc-cal-cell.today::after{content:'';position:absolute;bottom:2px;width:4px;height:4px;border-radius:50%;background:${PK}}
      .pc-cal-cell.period{background:${PK};color:#fff;font-weight:700}
      .pc-cal-cell.period:hover{background:${PKD}}
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
      .pc-sync-btn{width:100%;padding:12px;border-radius:12px;background:${PK};color:#fff;border:none;font-weight:700;font-size:14px;cursor:pointer;margin-top:8px}
      .pc-sync-preview{font-size:11px;color:${T2};background:#fff;border:1px solid ${BD};border-radius:8px;padding:10px;margin-top:8px;white-space:pre-wrap;line-height:1.5;font-family:monospace}
      .pc-add-btn{display:flex;align-items:center;justify-content:center;gap:6px;width:100%;padding:10px;border-radius:12px;background:${PKL};color:${PK};border:1px solid ${PK}30;font-weight:600;font-size:13px;cursor:pointer;margin-top:8px}
      .pc-mask{position:absolute;inset:0;z-index:200;background:rgba(0,0,0,.45);display:flex;align-items:flex-end}
      .pc-set{width:100%;background:#fff;border-radius:16px 16px 0 0;padding:18px;max-height:80%;overflow-y:auto}
      .pc-sl{display:block;font-size:12px;font-weight:600;color:${T2};margin:10px 0 4px}
      .pc-si{width:100%;padding:9px 12px;border-radius:10px;border:1px solid ${BD};font-size:13px;outline:none;background:#FAFAFA;font-family:inherit}
      .pc-sbtn{width:100%;padding:11px 0;border-radius:24px;background:${PK};color:#fff;border:none;font-weight:700;font-size:14px;margin-top:14px;cursor:pointer}
      .pc-toast{position:absolute;top:60px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.7);color:#fff;padding:8px 18px;border-radius:20px;font-size:13px;z-index:300;pointer-events:none;animation:pf .3s}
      @keyframes pf{from{opacity:0;transform:translateX(-50%) translateY(-8px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
    `;
    container.appendChild(style);

    function esc(s){return s?String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'):''}
    function toast(m){const t=document.createElement('div');t.className='pc-toast';t.textContent=m;root.appendChild(t);setTimeout(()=>t.remove(),2500)}

    // ── Render ──
    const root=document.createElement('div');root.className='pc';container.appendChild(root);
    function render(){
      let h='';
      h+=`<div class="pc-hdr"><button class="pc-hdr-btn" data-a="exit"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg></button><span style="font-weight:800;font-size:17px;color:${PK}">🩸 月經日曆</span><button class="pc-hdr-btn" data-a="settings"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${T2}" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></button></div>`;
      h+=`<div class="pc-body">`;

      // Status card
      const info=getCycleInfo();
      if(info){
        h+=`<div class="pc-status" style="background:linear-gradient(135deg,${info.phaseColor},${info.phaseColor}cc)"><div class="pc-status-phase">${info.phase}</div><div class="pc-status-detail">週期第 ${info.dayInCycle} 天<br>下次月經：${ds(info.nextStart)}（${info.daysUntilNext>0?'還有 '+info.daysUntilNext+' 天':'就是今天！'})${info.isPMS?'<br>⚠️ 經前期 PMS — 注意情緒波動':''}</div><div class="pc-status-day">D${info.dayInCycle}</div></div>`;
        // Stats
        const lens=calcCycleLengths();
        h+=`<div class="pc-stats"><div class="pc-stat"><div class="v">${info.avgCycle}</div><div class="l">平均週期</div></div><div class="pc-stat"><div class="v">${info.avgDays}</div><div class="l">平均經期</div></div><div class="pc-stat"><div class="v">${lens.length?Math.min(...lens)+'-'+Math.max(...lens):'--'}</div><div class="l">週期範圍</div></div><div class="pc-stat"><div class="v">${S.periods.length}</div><div class="l">記錄筆數</div></div></div>`;
      }else{
        h+=`<div class="pc-status" style="background:linear-gradient(135deg,${T3},${T3}cc)"><div class="pc-status-phase">尚未記錄</div><div class="pc-status-detail">請新增月經記錄或到日曆點選月經開始日</div></div>`;
      }

      // Calendar
      h+=vCalendar();
      // Legend
      h+=`<div class="pc-legend"><div class="pc-legend-item"><div class="pc-legend-dot" style="background:${PK}"></div>月經期</div><div class="pc-legend-item"><div class="pc-legend-dot" style="background:${PRED}"></div>預測</div><div class="pc-legend-item"><div class="pc-legend-dot" style="background:${FO}"></div>卵泡期</div><div class="pc-legend-item"><div class="pc-legend-dot" style="background:${OV}"></div>排卵期</div><div class="pc-legend-item"><div class="pc-legend-dot" style="background:${LU}"></div>黃體期</div></div>`;

      // History
      h+=vHistory();

      // Sync
      h+=`<div class="pc-sync"><div style="font-weight:700;font-size:14px;margin-bottom:4px">📤 同步給 ${esc(S.cfg.charName||'角色')}</div><div style="font-size:12px;color:${T3}">將週期狀態寫入聊天記憶，TA 會自然知道你的身體狀況</div>`;
      const syncText=buildSyncText();
      if(syncText)h+=`<div class="pc-sync-preview">${esc(syncText)}</div>`;
      h+=`<button class="pc-sync-btn" data-a="sync">🔄 同步到聊天記憶</button>`;
      if(S.syncMsg)h+=`<div style="font-size:12px;margin-top:8px;color:${S.syncErr?'#CC3333':'#2d8a5f'}">${esc(S.syncMsg)}</div>`;
      h+=`</div>`;

      h+=`</div>`;
      if(S.showSettings)h+=vSettings();
      if(S.editingPeriod!==null)h+=vEditPeriod();
      root.innerHTML=h;
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
        if(status?.type==='period')cls+=' period';
        else if(status?.type==='predicted')cls+=' predicted';
        h+=`<div class="${cls}" data-a="tap-date" data-d="${dateS}"><span>${d}</span>`;
        if(status&&status.type!=='period'&&status.type!=='predicted')h+=`<div class="dot" style="background:${status.color}"></div>`;
        h+=`</div>`;
      }
      h+=`</div></div>`;
      return h;
    }

    function vHistory(){
      const sorted=getSortedPeriods().reverse();
      const lens=calcCycleLengths().reverse();
      let h=`<div class="pc-history"><div class="pc-history-title"><span>📋 月經記錄</span><button class="pc-add-btn" data-a="add-period" style="width:auto;margin:0;padding:6px 14px;font-size:12px">+ 新增</button></div>`;
      h+=`<div style="background:#f8f8f8;border-radius:12px;overflow:hidden">`;
      sorted.forEach((p,i)=>{
        const cycleLen=i<lens.length?lens[i]:null;
        h+=`<div class="pc-history-item"><div><div class="pc-history-date">${p.start}</div><div class="pc-history-info">經期 ${p.days} 天${cycleLen?' · 週期 '+cycleLen+' 天':''}</div></div><div style="display:flex;gap:4px"><button class="pc-history-del" data-a="edit-period" data-idx="${S.periods.indexOf(p)}">✏️</button><button class="pc-history-del" data-a="del-period" data-idx="${S.periods.indexOf(p)}">✕</button></div></div>`;
      });
      if(!sorted.length)h+=`<div style="padding:20px;text-align:center;color:${T3}">還沒有記錄</div>`;
      h+=`</div></div>`;
      return h;
    }

    function vEditPeriod(){
      const isNew=S.editingPeriod==='new';
      const p=isNew?{start:ds(new Date()),days:7}:S.periods[S.editingPeriod];
      if(!p)return'';
      return`<div class="pc-mask"><div class="pc-set"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px"><span style="font-weight:700;font-size:15px">${isNew?'新增記錄':'編輯記錄'}</span><button data-a="close-edit" style="background:none;border:none;font-size:18px;color:${T3};cursor:pointer">✕</button></div><label class="pc-sl">月經開始日</label><input class="pc-si" type="date" data-f="edit-start" value="${p.start}"><label class="pc-sl">持續天數</label><input class="pc-si" type="number" data-f="edit-days" min="1" max="15" value="${p.days}"><button data-a="save-period" class="pc-sbtn">${isNew?'新增':'儲存'}</button></div></div>`;
    }

    function vSettings(){
      const c=S.cfg;
      let h=`<div class="pc-mask"><div class="pc-set"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px"><span style="font-weight:700;font-size:15px">設定</span><button data-a="close-set" style="background:none;border:none;font-size:18px;color:${T3};cursor:pointer">✕</button></div>`;
      h+=`<label class="pc-sl">同步給誰？</label><select class="pc-si" data-f="charId">${S.charList.map(ch=>`<option value="${esc(ch.id)}" ${ch.id===c.charId?'selected':''}>${esc(ch.name||ch.handle)}</option>`).join('')}</select>`;
      h+=`<label class="pc-sl">寫入哪個對話？</label><select class="pc-si" data-f="convId">${S.convList.map(cv=>{const cid=cv.conversationId||cv.id;return`<option value="${esc(cid)}" ${cid===c.convId?'selected':''}>${esc(cv.name||cv.handle||cid)}</option>`}).join('')}</select>`;
      h+=`<label class="pc-sl">你的名字</label><input class="pc-si" data-f="userName" value="${esc(c.userName)}">`;
      h+=`<button data-a="save-set" class="pc-sbtn">儲存設定</button>`;
      h+=`<button data-a="reset-data" class="pc-sbtn" style="background:#fff;color:${PK};border:1px solid ${PK};margin-top:8px">🗑️ 重置為預設資料</button>`;
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
      else if(a==='prev-month'){S.viewMonth--;if(S.viewMonth<0){S.viewMonth=11;S.viewYear--;}render();}
      else if(a==='next-month'){S.viewMonth++;if(S.viewMonth>11){S.viewMonth=0;S.viewYear++;}render();}
      else if(a==='tap-date'){
        const d=b.dataset.d;
        // 檢查是否已有這天的記錄
        const existing=S.periods.findIndex(p=>p.start===d);
        if(existing>=0){S.editingPeriod=existing;}
        else{S.editingPeriod='new';/* 預填日期在 vEditPeriod 處理 */}
        // 暫存點擊的日期
        S._tapDate=d;
        render();
      }
      else if(a==='add-period'){S.editingPeriod='new';S._tapDate=ds(new Date());render();}
      else if(a==='edit-period'){S.editingPeriod=parseInt(b.dataset.idx);render();}
      else if(a==='del-period'){
        const idx=parseInt(b.dataset.idx);
        if(!isNaN(idx)){S.periods.splice(idx,1);savePeriods();toast('已刪除');render();}
      }
      else if(a==='save-period'){
        const startEl=root.querySelector('[data-f="edit-start"]');
        const daysEl=root.querySelector('[data-f="edit-days"]');
        const start=startEl?.value||(S._tapDate||ds(new Date()));
        const days=parseInt(daysEl?.value)||7;
        if(S.editingPeriod==='new'){
          // 檢查重複
          if(!S.periods.find(p=>p.start===start)){
            S.periods.push({start,days});
            S.periods.sort((a,b)=>a.start.localeCompare(b.start));
            savePeriods();toast('已新增 '+start);
          }else{toast('已存在該日期的記錄');}
        }else{
          S.periods[S.editingPeriod]={start,days};
          S.periods.sort((a,b)=>a.start.localeCompare(b.start));
          savePeriods();toast('已更新');
        }
        S.editingPeriod=null;render();
      }
      else if(a==='sync'){syncToMemory();}
      else if(a==='save-set'){
        root.querySelectorAll('[data-f]').forEach(el=>{S.cfg[el.dataset.f]=el.value;});
        const ch=S.charList.find(c=>c.id===S.cfg.charId);if(ch)S.cfg.charName=ch.name||ch.handle||'';
        saveCfg();S.showSettings=false;toast('已儲存');render();
      }
      else if(a==='reset-data'){
        S.periods=[...DEFAULT_PERIODS];savePeriods();
        S.showSettings=false;toast('已重置');render();
      }
    }
    root.addEventListener('click',onClick);
    render();

    // 自動同步
    if(S.cfg.autoSync&&S.periods.length&&S.cfg.convId){setTimeout(()=>syncToMemory(),1500);}

    this._el=root;this._st=style;this._fn=onClick;
  },

  async unmount(container){
    if(this._el){this._el.removeEventListener('click',this._fn);this._el.remove();}
    if(this._st)this._st.remove();
    container.replaceChildren();
  }
};
window.RochePlugin.register({id:'roche-period-calendar',name:'月經日曆',version:'2.0.0',description:'同步月經週期給 TA',author:'予佟',apps:[app]});
})();
