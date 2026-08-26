/**
 * 月經日曆 — Roche Plugin
 * 記錄週期，同步狀態給 char，讓 TA 自然關心你
 */
(function(){
'use strict';
const app={
  id:'period-cal',name:'月經日曆',icon:'calendar_month',iconImage:'',

  async mount(container,roche){
    const PK='#FF6B81',PKL='#FFF0F3',PKD='#E84565',BG='#fff',T1='#222',T2='#666',T3='#999',BD='#F0F0F0';
    const OV='#9B59B6',OVL='#F3E8FF',LU='#F39C12',LUL='#FFF8E8',FO='#3498DB',FOL='#EBF5FF';
    const DAYS=['日','一','二','三','四','五','六'];
    const MONTHS=['一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月'];

    // ── State ──
    const S={
      showSettings:false,
      cfg:{cycleLen:28,periodLen:5,charId:'',charName:'',convId:'',userName:'',autoSync:true},
      periodDates:[],  // 每次月經開始日 ['2026-08-02','2026-07-05',...]
      viewYear:new Date().getFullYear(),
      viewMonth:new Date().getMonth(),
      charList:[],
      convList:[],
      syncMsg:'',syncErr:false,
      probeResult:null,
    };

    // ── Storage ──
    const load=async k=>{try{const s=await roche.storage.get(k);return s?JSON.parse(s):null}catch(_){return null}};
    const sv=async(k,v)=>{try{await roche.storage.set(k,JSON.stringify(v))}catch(_){}};
    Object.assign(S.cfg,(await load('pc_cfg'))||{});
    S.periodDates=(await load('pc_dates'))||[];
    const saveCfg=()=>sv('pc_cfg',S.cfg);
    const saveDates=()=>sv('pc_dates',S.periodDates);

    try{S.charList=await roche.character.list()||[]}catch(_){}
    try{S.convList=await roche.conversation.list()||[]}catch(_){}
    // 自動填入 user name
    if(!S.cfg.userName){
      try{const u=await roche.persona.getActiveUserPersona();if(u)S.cfg.userName=u.name||u.handle||'';}catch(_){}
    }
    if(!S.cfg.charId&&S.charList.length){S.cfg.charId=S.charList[0].id;S.cfg.charName=S.charList[0].name}
    // 自動匹配對話：找跟選定角色對應的對話
    if(!S.cfg.convId&&S.convList.length){
      const match=S.convList.find(c=>c.contactId===S.cfg.charId||c.name===S.cfg.charName);
      if(match)S.cfg.convId=match.conversationId||match.id;
      else S.cfg.convId=S.convList[0].conversationId||S.convList[0].id;
    }

    // ── 週期計算 ──
    function dateStr(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
    function parseDate(s){const[y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d)}
    function daysBetween(a,b){return Math.round((b-a)/(86400000))}

    function getLastPeriodStart(){
      if(!S.periodDates.length)return null;
      const sorted=[...S.periodDates].sort().reverse();
      return parseDate(sorted[0]);
    }

    function getCycleInfo(refDate){
      const last=getLastPeriodStart();
      if(!last)return null;
      const today=refDate||new Date();
      const daysSinceLast=daysBetween(last,today);
      const cl=S.cfg.cycleLen,pl=S.cfg.periodLen;
      const dayInCycle=((daysSinceLast%cl)+cl)%cl+1;
      const nextPeriod=new Date(last);
      while(nextPeriod<=today)nextPeriod.setDate(nextPeriod.getDate()+cl);
      const daysUntilNext=daysBetween(today,nextPeriod);

      let phase,phaseDay,phaseColor,phaseBg;
      if(dayInCycle<=pl){
        phase='月經期';phaseDay=dayInCycle;phaseColor=PK;phaseBg=PKL;
      }else if(dayInCycle<=cl-14){
        phase='卵泡期';phaseDay=dayInCycle-pl;phaseColor=FO;phaseBg=FOL;
      }else if(dayInCycle<=cl-11){
        phase='排卵期';phaseDay=dayInCycle-(cl-14);phaseColor=OV;phaseBg=OVL;
      }else{
        phase='黃體期';phaseDay=dayInCycle-(cl-11);phaseColor=LU;phaseBg=LUL;
      }

      const isPMS=daysUntilNext<=5&&phase==='黃體期';
      return{dayInCycle,phase,phaseDay,phaseColor,phaseBg,daysUntilNext,nextPeriod,isPMS,lastStart:last,cycleLen:cl,periodLen:pl};
    }

    // 判斷某一天的狀態（用於日曆渲染）
    function getDayPhase(date){
      if(!S.periodDates.length)return null;
      const sorted=[...S.periodDates].sort();
      const cl=S.cfg.cycleLen,pl=S.cfg.periodLen;
      // 找最近的上一次月經開始
      let lastStart=null;
      for(let i=sorted.length-1;i>=0;i--){
        if(parseDate(sorted[i])<=date){lastStart=parseDate(sorted[i]);break;}
      }
      if(!lastStart){
        // date 在所有記錄之前，用最早的記錄往前推
        lastStart=parseDate(sorted[0]);
        while(lastStart>date)lastStart.setDate(lastStart.getDate()-cl);
      }
      const days=daysBetween(lastStart,date);
      const dayInCycle=((days%cl)+cl)%cl+1;
      if(dayInCycle<=pl)return{phase:'period',color:PK};
      if(dayInCycle<=cl-14)return{phase:'follicular',color:FO};
      if(dayInCycle<=cl-11)return{phase:'ovulation',color:OV};
      return{phase:'luteal',color:LU};
    }

    // ── 生成同步文字 ──
    function buildSyncText(){
      const info=getCycleInfo();
      if(!info)return null;
      const today=new Date();
      const ds=dateStr(today);
      const nextDs=dateStr(info.nextPeriod);
      let text=`[月經週期同步 ${ds}]\n`;
      text+=`目前階段：${info.phase}（第${info.phaseDay}天）\n`;
      text+=`上次月經：${dateStr(info.lastStart)}\n`;
      text+=`下次預計：${nextDs}（還有${info.daysUntilNext}天）\n`;
      text+=`週期長度：${info.cycleLen}天 / 經期${info.periodLen}天\n`;
      if(info.phase==='月經期'){
        text+=`狀態：正在生理期中，可能有經痛、疲倦、情緒低落。請溫柔對待、主動關心。\n`;
      }else if(info.isPMS){
        text+=`狀態：經前期，可能出現 PMS 症狀（情緒波動、易怒、疲倦、腹脹、想吃甜食）。請多包容、不要計較。\n`;
      }else if(info.phase==='排卵期'){
        text+=`狀態：排卵期，精力較好，心情通常不錯。\n`;
      }else{
        text+=`狀態：一般狀態。\n`;
      }
      return text;
    }

    // ── 同步到記憶 ──
    async function syncToMemory(){
      const text=buildSyncText();
      if(!text){S.syncMsg='請先標記至少一次月經開始日';S.syncErr=true;render();return;}
      const convId=S.cfg.convId;
      if(!convId){S.syncMsg='找不到對話 ID，請到設定選擇對話';S.syncErr=true;render();return;}
      try{
        const today=dateStr(new Date());
        await roche.memory.write({
          conversationId: convId,
          summaryText: text,
          who: [S.cfg.userName||'用戶', S.cfg.charName||'角色'],
          action: text,
          when: today,
          where: '月經日曆同步',
          source: 'plugin:period-calendar'
        });
        S.syncMsg='✅ 已同步到「'+S.cfg.charName+'」的聊天記憶';
        S.syncErr=false;
        toast('✨ 已同步給 '+(S.cfg.charName||'角色'));
      }catch(e){
        S.syncMsg='同步失敗：'+e.message;
        S.syncErr=true;
      }
      render();
    }

    // ── 探測 memory.write 參數 ──
    async function probeMemoryWrite(){
      const results=[];
      const testCases=[
        {label:'write(string)',fn:()=>roche.memory.write('[測試] 月經日曆探測')},
        {label:'write({text})',fn:()=>roche.memory.write({text:'[測試] 月經日曆探測'})},
        {label:'write({content})',fn:()=>roche.memory.write({content:'[測試] 月經日曆探測'})},
        {label:'write({action,who})',fn:()=>roche.memory.write({action:'[測試] 月經日曆探測',who:['系統']})},
        {label:'write(text,type)',fn:()=>roche.memory.write('[測試] 月經日曆探測','fact')},
      ];
      for(const t of testCases){
        try{const r=await t.fn();results.push(`✅ ${t.label} → ${JSON.stringify(r).slice(0,200)}`);}
        catch(e){results.push(`❌ ${t.label} → ${e.message}`);}
      }
      S.probeResult=results.join('\n');
      render();
    }

    // ── Style ──
    const style=document.createElement('style');
    style.textContent=`
      .pc{width:100%;height:100%;position:relative;overflow:hidden;font-family:-apple-system,"PingFang SC","Helvetica Neue",sans-serif;background:${BG};display:flex;flex-direction:column;color:${T1}}
      .pc *{box-sizing:border-box}
      .pc-hdr{height:50px;display:flex;align-items:center;justify-content:space-between;padding:0 14px;border-bottom:1px solid ${BD};flex-shrink:0}
      .pc-hdr-btn{width:34px;height:34px;display:flex;align-items:center;justify-content:center;background:none;border:none;border-radius:50%;cursor:pointer;color:${T1}}
      .pc-body{flex:1;overflow-y:auto;padding:0 0 20px}

      /* Status card */
      .pc-status{margin:14px;border-radius:16px;padding:18px;color:#fff;position:relative;overflow:hidden}
      .pc-status-phase{font-size:24px;font-weight:800}
      .pc-status-detail{font-size:13px;margin-top:6px;opacity:.9;line-height:1.5}
      .pc-status-day{position:absolute;right:18px;top:18px;font-size:48px;font-weight:900;opacity:.2}

      /* Calendar */
      .pc-cal{margin:0 14px}
      .pc-cal-hdr{display:flex;align-items:center;justify-content:space-between;padding:8px 0}
      .pc-cal-hdr span{font-weight:700;font-size:15px}
      .pc-cal-hdr button{background:none;border:none;font-size:18px;cursor:pointer;color:${T1};padding:4px 10px}
      .pc-cal-days{display:grid;grid-template-columns:repeat(7,1fr);text-align:center;font-size:12px;color:${T3};padding:4px 0}
      .pc-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px}
      .pc-cal-cell{aspect-ratio:1;display:flex;flex-direction:column;align-items:center;justify-content:center;border-radius:50%;cursor:pointer;font-size:14px;position:relative;transition:background .15s}
      .pc-cal-cell:hover{background:#f5f5f5}
      .pc-cal-cell.today{font-weight:800}
      .pc-cal-cell.today::after{content:'';position:absolute;bottom:3px;width:4px;height:4px;border-radius:50%;background:${PK}}
      .pc-cal-cell.marked{background:${PK};color:#fff;font-weight:700}
      .pc-cal-cell.marked:hover{background:${PKD}}
      .pc-cal-cell .dot{width:5px;height:5px;border-radius:50%;position:absolute;bottom:4px}
      .pc-cal-cell.empty{cursor:default}
      .pc-cal-cell.empty:hover{background:transparent}

      /* Legend */
      .pc-legend{display:flex;gap:12px;justify-content:center;margin:12px 14px;flex-wrap:wrap}
      .pc-legend-item{display:flex;align-items:center;gap:4px;font-size:11px;color:${T2}}
      .pc-legend-dot{width:10px;height:10px;border-radius:50%}

      /* Sync */
      .pc-sync{margin:14px;padding:14px;border-radius:12px;background:#f8f8f8;border:1px solid ${BD}}
      .pc-sync-btn{width:100%;padding:12px;border-radius:12px;background:${PK};color:#fff;border:none;font-weight:700;font-size:14px;cursor:pointer;margin-top:8px}
      .pc-sync-btn:hover{background:${PKD}}
      .pc-sync-preview{font-size:11px;color:${T2};background:#fff;border:1px solid ${BD};border-radius:8px;padding:10px;margin-top:8px;white-space:pre-wrap;line-height:1.5;font-family:monospace}

      /* Settings */
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
      // Header
      h+=`<div class="pc-hdr"><button class="pc-hdr-btn" data-a="exit"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg></button><span style="font-weight:800;font-size:17px;color:${PK}">🩸 月經日曆</span><button class="pc-hdr-btn" data-a="settings"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${T2}" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></button></div>`;
      h+=`<div class="pc-body">`;
      // Status card
      const info=getCycleInfo();
      if(info){
        h+=`<div class="pc-status" style="background:linear-gradient(135deg,${info.phaseColor},${info.phaseColor}cc)"><div class="pc-status-phase">${info.phase}</div><div class="pc-status-detail">第 ${info.phaseDay} 天　·　週期第 ${info.dayInCycle} 天<br>下次月經：還有 ${info.daysUntilNext} 天${info.isPMS?'<br>⚠️ 經前期 PMS — 可能情緒波動':''}</div><div class="pc-status-day">D${info.dayInCycle}</div></div>`;
      }else{
        h+=`<div class="pc-status" style="background:linear-gradient(135deg,${T3},${T3}cc)"><div class="pc-status-phase">尚未記錄</div><div class="pc-status-detail">請在下方日曆中點選月經開始日<br>（點日期 = 標記/取消標記該天為月經來潮日）</div></div>`;
      }
      // Calendar
      h+=vCalendar();
      // Legend
      h+=`<div class="pc-legend"><div class="pc-legend-item"><div class="pc-legend-dot" style="background:${PK}"></div>月經期</div><div class="pc-legend-item"><div class="pc-legend-dot" style="background:${FO}"></div>卵泡期</div><div class="pc-legend-item"><div class="pc-legend-dot" style="background:${OV}"></div>排卵期</div><div class="pc-legend-item"><div class="pc-legend-dot" style="background:${LU}"></div>黃體期</div></div>`;
      // Sync
      h+=`<div class="pc-sync"><div style="font-weight:700;font-size:14px;margin-bottom:4px">📤 同步給 ${esc(S.cfg.charName||'角色')}</div><div style="font-size:12px;color:${T3}">將你目前的月經週期狀態寫入聊天記憶，讓 TA 在對話時自然知道你的身體狀況</div>`;
      const syncText=buildSyncText();
      if(syncText)h+=`<div class="pc-sync-preview">${esc(syncText)}</div>`;
      h+=`<button class="pc-sync-btn" data-a="sync">🔄 同步到聊天記憶</button>`;
      if(S.syncMsg)h+=`<div style="font-size:12px;margin-top:8px;color:${S.syncErr?'#CC3333':'#2d8a5f'}">${esc(S.syncMsg)}</div>`;
      h+=`</div>`;
      h+=`</div>`; // body end
      // Settings
      if(S.showSettings)h+=vSettings();
      root.innerHTML=h;
    }

    function vCalendar(){
      const y=S.viewYear,m=S.viewMonth;
      const firstDay=new Date(y,m,1).getDay();
      const daysInMonth=new Date(y,m+1,0).getDate();
      const today=new Date();const todayStr=dateStr(today);

      let h=`<div class="pc-cal"><div class="pc-cal-hdr"><button data-a="prev-month">◀</button><span>${y}年 ${MONTHS[m]}</span><button data-a="next-month">▶</button></div>`;
      h+=`<div class="pc-cal-days">${DAYS.map(d=>`<span>${d}</span>`).join('')}</div>`;
      h+=`<div class="pc-cal-grid">`;
      // Empty cells
      for(let i=0;i<firstDay;i++)h+=`<div class="pc-cal-cell empty"></div>`;
      // Day cells
      for(let d=1;d<=daysInMonth;d++){
        const date=new Date(y,m,d);
        const ds=dateStr(date);
        const isToday=ds===todayStr;
        const isMarked=S.periodDates.includes(ds);
        const phase=getDayPhase(date);
        let cls='pc-cal-cell';
        if(isToday)cls+=' today';
        if(isMarked)cls+=' marked';
        h+=`<div class="${cls}" data-a="toggle-date" data-d="${ds}">`;
        h+=`<span>${d}</span>`;
        if(!isMarked&&phase&&S.periodDates.length){
          h+=`<div class="dot" style="background:${phase.color}"></div>`;
        }
        h+=`</div>`;
      }
      h+=`</div></div>`;
      return h;
    }

    function vSettings(){
      const c=S.cfg;
      let h=`<div class="pc-mask"><div class="pc-set"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px"><span style="font-weight:700;font-size:15px">設定</span><button data-a="close-set" style="background:none;border:none;font-size:18px;color:${T3};cursor:pointer">✕</button></div>`;
      h+=`<label class="pc-sl">同步給誰？</label><select class="pc-si" data-f="charId">${S.charList.map(ch=>`<option value="${esc(ch.id)}" ${ch.id===c.charId?'selected':''}>${esc(ch.name||ch.handle)}</option>`).join('')}</select>`;
      h+=`<label class="pc-sl">寫入哪個對話的記憶？</label><select class="pc-si" data-f="convId">${S.convList.map(cv=>{const cid=cv.conversationId||cv.id;return`<option value="${esc(cid)}" ${cid===c.convId?'selected':''}>${esc(cv.name||cv.handle||cid)}</option>`}).join('')}</select>`;
      h+=`<label class="pc-sl">你的名字</label><input class="pc-si" data-f="userName" value="${esc(c.userName)}" placeholder="用於記憶中標記「誰」">`;
      h+=`<label class="pc-sl">週期長度（天）</label><input class="pc-si" data-f="cycleLen" type="number" min="20" max="45" value="${c.cycleLen||28}" style="width:100px">`;
      h+=`<label class="pc-sl">經期長度（天）</label><input class="pc-si" data-f="periodLen" type="number" min="2" max="10" value="${c.periodLen||5}" style="width:100px">`;
      h+=`<button data-a="save-set" class="pc-sbtn">儲存設定</button>`;
      h+=`<button data-a="clear-dates" class="pc-sbtn" style="background:#fff;color:${PK};border:1px solid ${PK};margin-top:8px">🗑️ 清除所有記錄</button>`;
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
      else if(a==='prev-month'){
        S.viewMonth--;
        if(S.viewMonth<0){S.viewMonth=11;S.viewYear--;}
        render();
      }
      else if(a==='next-month'){
        S.viewMonth++;
        if(S.viewMonth>11){S.viewMonth=0;S.viewYear++;}
        render();
      }
      else if(a==='toggle-date'){
        const d=b.dataset.d;
        const idx=S.periodDates.indexOf(d);
        if(idx>=0)S.periodDates.splice(idx,1);
        else S.periodDates.push(d);
        S.periodDates.sort();
        saveDates();render();
      }
      else if(a==='sync'){syncToMemory();}
      else if(a==='probe-write'){probeMemoryWrite();}
      else if(a==='save-set'){
        root.querySelectorAll('[data-f]').forEach(el=>{
          const v=el.value;
          if(el.dataset.f==='cycleLen'||el.dataset.f==='periodLen')S.cfg[el.dataset.f]=parseInt(v)||28;
          else S.cfg[el.dataset.f]=v;
        });
        const ch=S.charList.find(c=>c.id===S.cfg.charId);
        if(ch)S.cfg.charName=ch.name||ch.handle||'';
        // 如果切了角色，自動匹配對話
        if(ch&&!S.cfg.convId){
          const match=S.convList.find(c=>c.contactId===S.cfg.charId||c.name===S.cfg.charName);
          if(match)S.cfg.convId=match.conversationId||match.id;
        }
        saveCfg();S.showSettings=false;toast('已儲存');render();
      }
      else if(a==='clear-dates'){
        S.periodDates=[];saveDates();
        S.showSettings=false;toast('已清除');render();
      }
    }
    root.addEventListener('click',onClick);
    render();

    // 自動同步（如果有記錄的話，每次開啟就同步一次）
    if(S.cfg.autoSync&&S.periodDates.length){
      setTimeout(()=>syncToMemory(),1000);
    }

    this._el=root;this._st=style;this._fn=onClick;
  },

  async unmount(container){
    if(this._el){this._el.removeEventListener('click',this._fn);this._el.remove();}
    if(this._st)this._st.remove();
    container.replaceChildren();
  }
};
window.RochePlugin.register({id:'roche-period-calendar',name:'月經日曆',version:'1.0.0',description:'同步月經週期給 TA',author:'予佟',apps:[app]});
})();
