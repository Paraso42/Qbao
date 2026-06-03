function showScreen(name){ document.querySelectorAll('.screen').forEach(el=>el.classList.remove('active')); const t=document.getElementById('screen-'+name); if(t)t.classList.add('active'); state.lastScreen=name; saveState(); }

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('mobile-open');
  var ov = document.getElementById('sidebar-overlay');
  if (ov) ov.classList.toggle('active');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('mobile-open');
  var ov = document.getElementById('sidebar-overlay');
  if (ov) ov.classList.remove('active');
}
function closeSidebarIfMobile() {
  if (window.innerWidth <= 768) closeSidebar();
}
document.addEventListener('DOMContentLoaded', init);
