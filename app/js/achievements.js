const ACTIONS = [
  { id:'first_step', name:'迈出第一步', icon:'👣', desc:'完成第一次答题', check:g=>g.totalAnswered>=1 },
  { id:'first_correct', name:'初次正确', icon:'✨', desc:'第一次答对客观题', check:g=>g.totalCorrect>=1 },
  { id:'first_chapter', name:'开卷有益', icon:'📖', desc:'完成第一轮答题', check:g=>g.totalRounds>=1 },
  { id:'five_answers', name:'初露锋芒', icon:'🌟', desc:'累计答题5道', check:g=>g.totalAnswered>=5 },
  { id:'ten_correct', name:'初战告捷', icon:'🎯', desc:'累计答对10道客观题', check:g=>g.totalCorrect>=10 },
  { id:'streak_5', name:'势如破竹', icon:'🔥', desc:'连续答对5题', check:g=>g.maxStreak>=5 },
  { id:'ten_questions', name:'勤学好问', icon:'📝', desc:'累计答题10道', check:g=>g.totalAnswered>=10 },
  { id:'three_chapters', name:'博采众长', icon:'📚', desc:'创建3个章节', check:g=>g.totalChapters>=3 },
  { id:'two_subjects', name:'学科兼修', icon:'🎓', desc:'创建2个科目', check:g=>g.totalSubjects>=2 },
  { id:'fifty_questions', name:'题海泛舟', icon:'🌊', desc:'累计答题50道', check:g=>g.totalAnswered>=50 },
  { id:'hundred_correct', name:'百步穿杨', icon:'🏹', desc:'累计答对100道客观题', check:g=>g.totalCorrect>=100 },
  { id:'streak_10', name:'连胜纪录', icon:'⚡', desc:'连续答对10题', check:g=>g.maxStreak>=10 },
  { id:'five_subjects', name:'博学多才', icon:'🌍', desc:'创建5个科目', check:g=>g.totalSubjects>=5 },
  { id:'hundred_questions', name:'学富五车', icon:'🏛️', desc:'累计答题100道', check:g=>g.totalAnswered>=100 },
  { id:'five_hundred_q', name:'学海无涯', icon:'🚢', desc:'累计答题500道', check:g=>g.totalAnswered>=500 },
  { id:'streak_20', name:'不可阻挡', icon:'💪', desc:'连续答对20题', check:g=>g.maxStreak>=20 },
  { id:'perfect_session', name:'完美发挥', icon:'💯', desc:'一轮10题以上全部答对', check:g=>g.hasPerfectSession },
  { id:'ten_subjects', name:'满腹经纶', icon:'👑', desc:'创建10个科目', check:g=>g.totalSubjects>=10 },
  { id:'thousand_questions', name:'题海大师', icon:'🏆', desc:'累计答题1000道', check:g=>g.totalAnswered>=1000 },
  { id:'streak_50', name:'神话传说', icon:'🐉', desc:'连续答对50题', check:g=>g.maxStreak>=50 }
];
function computeGlobalStats() { let totalAnswered=0,totalCorrect=0,totalWrong=0,totalRounds=state.history?state.history.length:0,maxStreak=0,hasPerfectSession=false; let typeDist={single:0,judge:0,term:0,short:0}; (state.history||[]).forEach(r=>{if(!r.questions)return; let streak=0; r.questions.forEach(q=>{typeDist[q.type]=(typeDist[q.type]||0)+1; if(q.userAnswer!==undefined){totalAnswered++; if(isObjType(q.type)){if(q.isCorrect===true){totalCorrect++;streak++;if(streak>maxStreak)maxStreak=streak;}else{totalWrong++;streak=0;}}}}); if(r.total>=10&&r.wrong===0)hasPerfectSession=true; }); const totalChapters=Object.values(state.chapters).filter(ch=>ch.questions&&ch.questions.length>0).length; return { totalAnswered, totalCorrect, totalWrong, totalRounds, maxStreak, hasPerfectSession, totalSubjects:Object.keys(state.subjects).length, totalChapters, typeDist }; }
function checkAchievements() { if(!state.achievements)state.achievements={unlocked:[],history:[]}; const g=computeGlobalStats(); let newUnlock=false; ACTIONS.forEach(a=>{ if(!state.achievements.unlocked.includes(a.id)&&a.check(g)){ state.achievements.unlocked.push(a.id); state.achievements.history.push({id:a.id,date:new Date().toLocaleString('zh-CN')}); newUnlock=true; } }); if(newUnlock){saveState();} return newUnlock; }
function renderAchievements() { const unlocked=state.achievements?state.achievements.unlocked:[]; const history=state.achievements?state.achievements.history:[]; const countEl=document.getElementById('ach-count-display'); if(countEl)countEl.innerHTML='已解锁 <strong>'+unlocked.length+'</strong> / '+ACTIONS.length; const grid=document.getElementById('achievements-grid'); if(!grid)return; grid.innerHTML=ACTIONS.map(a=>{ const isUnlocked=unlocked.includes(a.id); const rec=history.find(h=>h.id===a.id); if(isUnlocked){ return '<div class="achievement-card unlocked"><div class="ach-icon">'+a.icon+'</div><div class="ach-name">'+escapeHtml(a.name)+'</div><div class="ach-desc">'+escapeHtml(a.desc)+'</div><div class="ach-status">🔓 '+escapeHtml(rec?rec.date:'已解锁')+'</div></div>'; } else { return '<div class="achievement-card locked"><div class="ach-mystery">❓</div><div class="ach-status">未解锁</div></div>'; } }).join(''); }