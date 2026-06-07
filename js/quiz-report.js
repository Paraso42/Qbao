function renderReport() {
  const ch=getCh(); const c=document.getElementById('report-content'); if (!c) return;
  if (!ch||!ch.questions||!ch.questions.length) { c.innerHTML='<div class="empty-state">暂无数据</div>'; return; }
  const stats=calcStats(ch); const correctTotal=stats.objCorrect+stats.subjCount; const rate=stats.objTotal>0?Math.round((stats.objCorrect/stats.objTotal)*100):0;
  let html='<div class="report-grid"><div class="report-stat correct"><div class="num">'+correctTotal+'</div><div class="label">✅ 总正确</div></div><div class="report-stat wrong"><div class="num">'+stats.wrongCount+'</div><div class="label">❌ 客观题错误</div></div><div class="report-stat rate"><div class="num">'+rate+'%</div><div class="label">📊 客观题正确率</div></div><div class="report-stat"><div class="num">'+stats.answered+'/'+stats.total+'</div><div class="label">📝 进度</div></div></div>';
  const wrongTags=new Set(); ch.questions.forEach((q,i)=>{if(isObjType(q.type)&&ch.userAnswers[i]!==undefined&&getCi(q,ch.userAnswers[i])===false&&q.tag) wrongTags.add(q.tag);});
  if (wrongTags.size>0) { html+='<hr style="margin:10px 0;"><div style="padding:8px;background:#fff8f0;border-radius:6px;"><h4 style="color:#c2410c;font-size:14px;margin-bottom:4px;">🏷️ 错题标签</h4><div style="display:flex;flex-wrap:wrap;gap:3px;">'; wrongTags.forEach(t=>{html+='<span style="background:#fed7aa;padding:1px 8px;border-radius:12px;font-size:12px;color:#9a3412;">'+escapeHtml(t)+'</span>';}); html+='</div></div>'; }
  html+='<hr style="margin:10px 0;"><h4 style="margin-bottom:8px;font-size:15px;">📋 逐题回顾</h4>';
  ch.questions.forEach((q,i)=>{const ua=ch.userAnswers[i];const ci=getCi(q,ua);const tm={single:'单选',judge:'判断',term:'名词解释',short:'简答'};let icon='⏳';if(ua!==undefined)icon=ci===true?'✅':(ci===false?'❌':'✅（主观题）');html+='<div class="history-q-item '+(ci===false?' wrong':ci===true?' correct':'')+'">';html+='<div class="q-text">'+icon+' <span class="q-type-badge">'+(tm[q.type]||q.type)+'</span> 第'+(i+1)+'题：'+escapeHtml(q.question)+'</div>';if(ua!==undefined){html+='<div class="q-detail">';if(q.type==='single'||q.type==='judge'){var labels=['A','B','C','D','E','F'];var yourLabel=labels[ua]||String(ua);var correctLabel=labels[q.answer]||String(q.answer);var yourMark=ci===true?'✓':'✗';var yaCls=ci===true?'q-answer your-answer correct':'q-answer your-answer wrong';html+='<span class="'+yaCls+'">'+yourMark+' 你的答案：'+yourLabel+'. '+escapeHtml(String(q.options[ua]??''))+'</span>';html+='<span class="q-answer correct-answer">✓ 标准答案：'+correctLabel+'. '+escapeHtml(String(q.options[q.answer]??''))+'</span>';}else{html+='<span style="color:var(--text-secondary);font-size:var(--fs-sm);">📝 你的答案：'+escapeHtml(String(ua))+'</span>';}html+='</div>';}if(q.explanation)html+='<div class="q-explanation">📖 '+escapeHtml(q.explanation)+'</div>';html+='</div>';});
  html+='<div style="margin-top:12px;text-align:center;"><button class="btn btn-primary btn-small" onclick="chatShareCurrentQuizSet()">📤 分享给好友</button></div>';c.innerHTML=html; if(stats.wrongCount>0){var b=document.getElementById("btn-review-wrong");if(b){b.style.display="inline-block";b.textContent="👀 只看错题 ("+stats.wrongCount+")";}}
}
// ===== 历史 =====
function renderReportForSet(as) {
  const c=document.getElementById('report-content'); if(!c) return;
  const stats=calcStats(as); const correctTotal=stats.objCorrect+stats.subjCount; const rate=stats.objTotal>0?Math.round((stats.objCorrect/stats.objTotal)*100):0;
  let html='<div class="report-grid"><div class="report-stat correct"><div class="num">'+correctTotal+'</div><div class="label">✅ 正确</div></div><div class="report-stat wrong"><div class="num">'+stats.wrongCount+'</div><div class="label">❌ 错误</div></div><div class="report-stat rate"><div class="num">'+rate+'%</div><div class="label">📊 正确率</div></div><div class="report-stat"><div class="num">'+stats.answered+'/'+stats.total+'</div><div class="label">📝 进度</div></div></div>';
  const wrongTags=new Set(); as.questions.forEach((q,i)=>{if(isObjType(q.type)&&as.userAnswers&&as.userAnswers[i]!==undefined&&getCi(q,as.userAnswers[i])===false&&q.tag) wrongTags.add(q.tag);});
  if(wrongTags.size>0){html+='<hr style="margin:10px 0;"><div style="padding:8px;background:#fff8f0;border-radius:6px;"><h4 style="color:#c2410c;font-size:14px;margin-bottom:4px;">🏷️ 错题标签</h4><div style="display:flex;flex-wrap:wrap;gap:3px;">';wrongTags.forEach(t=>{html+='<span style="background:#fed7aa;padding:1px 8px;border-radius:12px;font-size:12px;color:#9a3412;">'+escapeHtml(t)+'</span>';});html+='</div></div>';}
  html+='<hr style="margin:10px 0;"><h4 style="margin-bottom:8px;font-size:15px;">📋 逐题回顾</h4>';
  as.questions.forEach((q,i)=>{const ua=as.userAnswers?as.userAnswers[i]:undefined;const ci=ua!==undefined?getCi(q,ua):null;const tm={single:'单选',judge:'判断',term:'名词解释',short:'简答'};let icon='⏳';if(ua!==undefined)icon=ci===true?'✅':(ci===false?'❌':'✅（主观题）');html+='<div class="history-q-item '+(ci===false?'wrong':ci===true?'correct':'')+'">';html+='<div class="q-text">'+icon+' <span class="q-type-badge">'+(tm[q.type]||q.type)+'</span> 第'+(i+1)+'题：'+escapeHtml(q.question)+'</div>';if(ua!==undefined){html+='<div class="q-detail">';if(q.type==='single'||q.type==='judge'){var labels=['A','B','C','D','E','F'];var yourLabel=labels[ua]||String(ua);var correctLabel=labels[q.answer]||String(q.answer);var yourMark=ci===true?'✓':'✗';var yaCls=ci===true?'q-answer your-answer correct':'q-answer your-answer wrong';html+='<span class="'+yaCls+'">'+yourMark+' 你的答案：'+yourLabel+'. '+escapeHtml(String(q.options[ua]??''))+'</span>';html+='<span class="q-answer correct-answer">✓ 标准答案：'+correctLabel+'. '+escapeHtml(String(q.options[q.answer]??''))+'</span>';}else{html+='<span style="color:var(--text-secondary);font-size:var(--fs-sm);">📝 你的答案：'+escapeHtml(String(ua))+'</span>';}html+='</div>';}if(q.explanation)html+='<div class="q-explanation">📖 '+escapeHtml(q.explanation)+'</div>';html+='</div>';});
  c.innerHTML=html; if(stats.wrongCount>0){var b=document.getElementById("btn-review-wrong");if(b){b.style.display="inline-block";b.textContent="👀 只看错题 ("+stats.wrongCount+")";}}
}

var _reportWrongOnly = false;
function showWrongOnlyReport() {
  _reportWrongOnly = !_reportWrongOnly;
  var btn = document.getElementById('btn-review-wrong');
  var allItems = document.querySelectorAll('#report-content .history-q-item');
  if (_reportWrongOnly) {
    if (btn) btn.textContent = '📋 显示全部';
    allItems.forEach(function(item) {
      if (!item.classList.contains('wrong')) item.style.display = 'none';
      else item.style.display = '';
    });
  } else {
    if (btn) { var as = getActiveSet(); if (as) { var stats = calcStats(as); btn.textContent = '👀 只看错题 (' + stats.wrongCount + ')'; } }
    allItems.forEach(function(item) { item.style.display = ''; });
  }
}
