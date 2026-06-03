function isObjType(t) { return t === 'single' || t === 'judge'; }
function getCi(q, answer) {
  if (!q) return false;
  if (answer === -1) return false; // 未作答判为错误
  if (q.type === 'term' || q.type === 'short') return true;
  if (q.type === 'single' || q.type === 'judge') return answer === q.answer;
  return null;
}
function escapeHtml(text) {
  if (typeof text !== 'string') return String(text ?? '');
  const d = document.createElement('div'); d.textContent = text; return d.innerHTML;
}
function renderMarkdown(text) {
  if (typeof text !== 'string') return escapeHtml(String(text ?? ''));
  let s = escapeHtml(text);
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_,m) => { try { return katex.renderToString(m.trim(),{displayMode:true,throwOnError:false}); } catch(e){ return '<code>'+m+'</code>'; } });
  s = s.replace(/\$([^\$]+?)\$/g, (_,m) => { try { return katex.renderToString(m.trim(),{displayMode:false,throwOnError:false}); } catch(e){ return '<code>'+m+'</code>'; } });
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\n/g, '<br>');
  return s;
}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function formatFileSize(bytes) { if(bytes<1024)return bytes+' B'; if(bytes<1048576)return (bytes/1024).toFixed(1)+' KB'; return (bytes/1048576).toFixed(1)+' MB'; }
function generateMaterialId() { return 'mat_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6); }