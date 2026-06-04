function updateBackupStatus(msg,type){var el=document.getElementById('backup-status');if(el){el.textContent=msg;el.style.color=type==='ok'?'#2ed573':type==='warn'?'#f59e0b':'#666';}}
function doManualBackup(){
  try {
    var data = JSON.stringify({backupVersion:8,createdAt:new Date().toISOString(),state:state}, null, 2);
    var blob = new Blob([data], {type:'application/json'});
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    var ts = new Date();
    var tsStr = ts.getFullYear()+'-'+String(ts.getMonth()+1).padStart(2,'0')+'-'+String(ts.getDate()).padStart(2,'0')+'_'+String(ts.getHours()).padStart(2,'0')+'-'+String(ts.getMinutes()).padStart(2,'0');
    a.download = 'Qbao_backup_' + tsStr + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
    updateBackupStatus('✅ 备份已下载', 'ok');
    if (typeof ucCurrentScreen !== 'undefined' && ucCurrentScreen === 'data') renderDataPage();
  } catch(e) {
    updateBackupStatus('⚠️ 备份失败: '+e.message, 'warn');
    alert('备份失败: ' + e.message);
  }
}
function restoreFromFile(){
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = function(e) {
    var file = e.target.files[0];
    if (!file) return;
    if (!confirm('回档后当前数据将被替换。建议先做一次备份。')) return;
    var reader = new FileReader();
    reader.onload = function(ev) {
      try {
        var data = JSON.parse(ev.target.result);
        if (!data || !data.state) throw new Error('无效的备份文件');
        state = migrateState(data.state);
        saveState();
        renderSubjectList();
        var sids = Object.keys(state.subjects);
        if (sids.length > 0) {
          if (!state.currentSubjectId || !state.subjects[state.currentSubjectId]) state.currentSubjectId = sids[0];
          var s = getSubj();
          if (s && (!state.currentChapterId || !state.chapters[state.currentChapterId])) state.currentChapterId = s.chapterIds[0] || null;
        }
        var ch = getCh();
        if (ch && ch.questions && ch.questions.length > 0) { renderQuestion(); updateProgress(); }
        renderHistory();
        updateQuickActions();
        loadChapterStrategyToUI();
        showScreen(state.lastScreen || 'start');
        updateBackupStatus('✅ 已回档', 'ok');
        if (typeof ucCurrentScreen !== 'undefined' && ucCurrentScreen === 'data') renderDataPage();
        alert('✅ 回档成功！');
      } catch(err) {
        alert('❌ 回档失败: ' + err.message);
      }
    };
    reader.readAsText(file);
  };
  input.click();
}
var backupDirHandle = null, backupMeta = [];
function openBackupDialog(){ doManualBackup(); }
function closeBackupDialog(){}
function setupBackupFromDialog(){ doManualBackup(); }
function changeBackupFolder(){ doManualBackup(); }
function refreshBackupMeta(){}
function openRestoreDialog(){ restoreFromFile(); }
function closeRestoreDialog(){}
function restoreFromBackup(filename){ restoreFromFile(); }
function tryAutoRestore(){ return false; }
function autoBackup(){}
