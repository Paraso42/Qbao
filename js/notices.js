var noticeCurrentIdx = 0, noticeTimer = null, noticeTransitioning = false;
var noticeTypeMap = { tip: { icon: '💡', color: '#4facfe' }, notice: { icon: '📢', color: '#f5a623' }, warning: { icon: '⚠️', color: '#e94560' }, chat: { icon: '⭐', color: '#2ed573' } };
async function loadNotices() {
  try {
    const res = await fetch(API_BASE + '/notices');
    if (res.ok) { state.notices = await res.json(); } else { state.notices = []; }
  } catch(e) { state.notices = []; }
  renderNoticeBar();
}
function renderNoticeBar() {
  var bar = document.getElementById('notice-bar');
  if (!bar) return;
  var notices = state.notices || [];
  if (notices.length === 0) { bar.style.display = 'none'; stopNoticeRotation(); return; }
  bar.style.display = 'flex';
  noticeCurrentIdx = 0;
  bar.textContent = (noticeTypeMap[notices[0].type] || noticeTypeMap.notice).icon + ' ' + notices[0].content;
  if (notices.length > 1) { startNoticeRotation(); } else { stopNoticeRotation(); }
}
function startNoticeRotation() {
  stopNoticeRotation();
  var notices = state.notices || [];
  if (notices.length === 0) return;
  var currentDuration = notices[noticeCurrentIdx] ? (notices[noticeCurrentIdx].duration || 4000) : 4000;
  noticeTimer = setTimeout(function() { rotateNotice(); }, currentDuration);
}
function pauseNoticeRotation() { stopNoticeRotation(); }
function resumeNoticeRotation() {
  var notices = state.notices || [];
  if (notices.length > 1 && !noticeTransitioning) startNoticeRotation();
}
function stopNoticeRotation() {
  if (noticeTimer) { clearTimeout(noticeTimer); noticeTimer = null; }
}
function rotateNotice() {
  var notices = state.notices || [];
  if (notices.length <= 1) return;
  var bar = document.getElementById('notice-bar');
  if (!bar) return;
  noticeTransitioning = true;
  bar.style.transition = 'opacity 0.5s ease';
  bar.style.opacity = '0';
  setTimeout(function() {
    noticeCurrentIdx = (noticeCurrentIdx + 1) % notices.length;
    bar.textContent = (noticeTypeMap[notices[noticeCurrentIdx].type] || noticeTypeMap.notice).icon + ' ' + notices[noticeCurrentIdx].content;
    bar.style.opacity = '1';
    var currentDuration = notices[noticeCurrentIdx].duration || 4000;
    setTimeout(function() { noticeTransitioning = false; startNoticeRotation(); }, 500);
  }, 500);
}
function clickNotice() {
  var notices = state.notices || [];
  if (!notices.length) return;
  var n = notices[noticeCurrentIdx];
  if (n.link) window.open(n.link, '_blank');
}
document.addEventListener('click', function(e) {
  var bar = document.getElementById('notice-bar');
  if (bar && bar.contains(e.target)) clickNotice();
});
async function loadAdminNotices() {
  if (!getToken()) return;
  var container = document.getElementById('notice-list-container');
  if (container) container.innerHTML = '<div style="text-align:center;color:#999;padding:20px;">加载中...</div>';
  try {
    var res = await fetchWithAuth('/notices/all');
    if (!res.ok) return;
    var data = await res.json();
    state._adminNotices = data;
    saveState();
    var preview = document.getElementById('notice-preview');
    if (preview) {
      var enabled = data.filter(function(n){return n.enabled;});
      if (enabled.length > 0) {
        var t = noticeTypeMap[enabled[0].type] || noticeTypeMap.notice;
        preview.innerHTML = '<span style="color:' + t.color + ';">' + t.icon + ' ' + escapeHtml(enabled[0].content) + '</span>';
      } else {
        preview.innerHTML = '暂无已启用的消息';
      }
    }
    renderNoticeList(data);
  } catch(e) {
    if (container) container.innerHTML = '<div style="text-align:center;color:#e94560;padding:20px;">加载失败: ' + escapeHtml(e.message) + '</div>';
  }
}
function renderNoticeList(notices) {
  var container = document.getElementById('notice-list-container');
  if (!container) return;
  if (!notices || notices.length === 0) {
    container.innerHTML = '<div style="text-align:center;color:#999;padding:20px;">暂无消息，点击"新增消息"添加</div>';
    return;
  }
  var html = '<div style="border:1px solid #e0e0e0;border-radius:8px;overflow:hidden;">';
  html += '<div style="display:flex;align-items:center;padding:8px 12px;background:#f8f9fa;font-size:11px;color:#888;border-bottom:1px solid #e0e0e0;"><span style="flex:2;">内容</span><span style="width:70px;">类型</span><span style="width:50px;text-align:center;">时长</span><span style="width:60px;text-align:center;">状态</span><span style="width:100px;">过期时间</span><span style="width:120px;text-align:right;">操作</span></div>';
  notices.forEach(function(n) {
    var t = noticeTypeMap[n.type] || noticeTypeMap.notice;
    var expireStr = n.expire_at ? new Date(n.expire_at).toLocaleDateString('zh-CN') : '永久';
    var durStr = n.duration ? (n.duration / 1000) + 's' : '4s';
    html += '<div data-id="' + n.id + '" style="display:flex;align-items:center;padding:8px 12px;border-bottom:1px solid #f0f0f0;';
    if (!n.enabled) html += 'background:#fafafa;opacity:0.6;';
    html += '">';
    html += '<span style="flex:2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeHtml(n.content) + '">' + escapeHtml(n.content) + '</span>';
    html += '<span style="width:70px;color:' + t.color + ';">' + t.icon + ' ' + n.type + '</span>';
    html += '<span style="width:50px;text-align:center;font-size:11px;color:#888;">' + durStr + '</span>';
    html += '<span style="width:60px;text-align:center;">';
    if (n.enabled) {
      html += '<label style="display:inline-flex;align-items:center;gap:3px;font-size:11px;cursor:pointer;"><input type="checkbox" checked onchange="toggleNotice(' + n.id + ')" style="accent-color:#2ed573;"> 启用</label>';
    } else {
      html += '<label style="display:inline-flex;align-items:center;gap:3px;font-size:11px;cursor:pointer;"><input type="checkbox" onchange="toggleNotice(' + n.id + ')" style="accent-color:#999;"> 启用</label>';
    }
    html += '</span>';
    html += '<span style="width:100px;font-size:11px;color:#888;">' + expireStr + '</span>';
    html += '<span style="width:120px;text-align:right;display:flex;gap:4px;justify-content:flex-end;">';
    html += '<button onclick="editNotice(' + n.id + ')" style="font-size:11px;padding:2px 8px;cursor:pointer;border:1px solid #ddd;background:#fff;border-radius:4px;">编辑</button>';
    html += '<button onclick="deleteNotice(' + n.id + ')" style="font-size:11px;padding:2px 8px;cursor:pointer;border:1px solid #e94560;color:#e94560;background:#fff;border-radius:4px;">删除</button>';
    html += '</span></div>';
  });
  html += '</div>';
  html += '<div style="margin-top:8px;font-size:11px;color:#888;">拖拽排序功能将在后续版本添加</div>';
  container.innerHTML = html;
}
async function toggleNotice(id) {
  try {
    await fetchWithAuth('/notices/' + id + '/toggle', { method: 'PATCH' });
    loadAdminNotices(); loadNotices();
  } catch(e) { alert('操作失败: ' + e.message); }
}
async function deleteNotice(id) {
  if (!confirm('确定删除此消息？')) return;
  try {
    await fetchWithAuth('/notices/' + id, { method: 'DELETE' });
    loadAdminNotices(); loadNotices();
  } catch(e) { alert('删除失败: ' + e.message); }
}
function openNoticeEditor(editId) {
  var existing = null;
  if (editId) {
    var adminData = state._adminNotices || [];
    existing = adminData.find(function(n){return n.id === editId;});
    if (!existing) return alert('未找到该消息，请刷新后重试');
  }
  var content = existing ? existing.content : '';
  var type = existing ? existing.type : 'notice';
  var link = existing ? (existing.link || '') : '';
  var expire = existing && existing.expire_at ? existing.expire_at.substring(0, 10) : '';
  var html = '<h3>' + (existing ? '✏️ 编辑消息' : '✏️ 新增消息') + '</h3>';
  html += '<div style="margin-bottom:10px;"><label style="display:block;font-size:13px;margin-bottom:4px;">内容（最多500字）</label>';
  html += '<textarea id="notice-edit-content" style="width:100%;min-height:60px;padding:8px;border:1px solid #dee2e6;border-radius:6px;font-size:13px;font-family:inherit;resize:vertical;" maxlength="500">' + escapeHtml(content) + '</textarea></div>';
  html += '<div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;">';
  html += '<div style="flex:1;min-width:120px;"><label style="display:block;font-size:12px;margin-bottom:3px;">类型</label>';
  html += '<select id="notice-edit-type" style="width:100%;padding:6px 8px;border:1px solid #dee2e6;border-radius:6px;font-size:13px;">';
  html += '<option value="tip"' + (type==='tip'?' selected':'') + '>💡 提示 (tip)</option>';
  html += '<option value="notice"' + (type==='notice'?' selected':'') + '>📢 通知 (notice)</option>';
  html += '<option value="warning"' + (type==='warning'?' selected':'') + '>⚠️ 警告 (warning)</option>';
  html += '<option value="chat"' + (type==='chat'?' selected':'') + '>⭐ 闲聊 (chat)</option></select></div>';
  html += '<div style="flex:2;min-width:180px;"><label style="display:block;font-size:12px;margin-bottom:3px;">链接（可选）</label>';
  html += '<input id="notice-edit-link" type="text" style="width:100%;padding:6px 8px;border:1px solid #dee2e6;border-radius:6px;font-size:13px;" placeholder="https://..." value="' + escapeHtml(link) + '"></div>';
  html += '<div style="flex:1;min-width:120px;"><label style="display:block;font-size:12px;margin-bottom:3px;">过期日期（可选）</label>';
  html += '<input id="notice-edit-expire" type="date" style="width:100%;padding:6px 8px;border:1px solid #dee2e6;border-radius:6px;font-size:13px;" value="' + expire + '"></div>';
  var duration = existing && existing.duration ? Math.round(existing.duration / 1000) : 4;
  html += '<div style="flex:1;min-width:100px;"><label style="display:block;font-size:12px;margin-bottom:3px;">展示时长(秒)</label>';
  html += '<input id="notice-edit-duration" type="number" min="2" max="15" step="0.5" style="width:100%;padding:6px 8px;border:1px solid #dee2e6;border-radius:6px;font-size:13px;" value="' + duration + '"></div></div>';
  html += '<div class="dialog-actions"><button class="btn btn-secondary btn-small" onclick="closeNoticeEditor()">取消</button>';
  html += '<button class="btn btn-success btn-small" onclick="saveNotice(' + (editId || 'null') + ')">保存</button></div>';
  var dialog = document.getElementById('notice-editor-dialog');
  if (!dialog) {
    dialog = document.createElement('div');
    dialog.className = 'dialog-overlay';
    dialog.id = 'notice-editor-dialog';
    dialog.setAttribute('onclick', 'if(event.target===this)closeNoticeEditor()');
    document.body.appendChild(dialog);
  }
  dialog.innerHTML = '<div class="dialog-box" style="max-width:560px;">' + html + '</div>';
  dialog.classList.add('active');
}
function closeNoticeEditor() {
  var dialog = document.getElementById('notice-editor-dialog');
  if (dialog) dialog.classList.remove('active');
}
function editNotice(id) { openNoticeEditor(id); }
async function saveNotice(editId) {
  var content = document.getElementById('notice-edit-content').value.trim();
  var type = document.getElementById('notice-edit-type').value;
  var link = document.getElementById('notice-edit-link').value.trim();
  var expire = document.getElementById('notice-edit-expire').value;
  var duration = parseFloat(document.getElementById('notice-edit-duration').value) || 4;
  if (!content) return alert('内容不能为空');
  var body = { content: content, type: type, duration: duration * 1000 };
  if (link) body.link = link;
  if (expire) body.expire_at = expire;
  try {
    var method = editId ? 'PUT' : 'POST';
    var path = editId ? '/notices/' + editId : '/notices';
    var res = await fetchWithAuth(path, { method: method, body: JSON.stringify(body) });
    if (!res.ok) { var e = await res.json().catch(()=>({})); return alert('保存失败: ' + (e.error || '未知错误')); }
    closeNoticeEditor();
    loadAdminNotices();
    loadNotices();
  } catch(e) { alert('保存失败: ' + e.message); }
}