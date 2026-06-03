const fs = require('fs');
const html = fs.readFileSync('D:/Qbao/index.html', 'utf-8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
const L = m[1].split('\n');
const D = 'D:/Qbao/js';

function w(name, sections) {
  let code = '';
  for (const [s, e] of sections) code += L.slice(s, e+1).join('\n') + '\n';
  // Remove trailing newline
  code = code.replace(/\n$/, '');
  fs.writeFileSync(D + '/' + name, code, 'utf-8');
  console.log(name + ' (' + code.split('\n').length + ' lines)');
}

// Based on 0-indexed line numbers from script content
// Config
w('config.js', [[2, 11]]);
// DB
w('db.js', [[14, 21]]);
// API
w('api.js', [[24, 62]]);
// State
w('state.js', [[64, 287], [288, 325]]);
// Utils (scattered functions)
w('utils.js', [[256, 278], [1524, 1524], [1512, 1512], [22, 22]]);
// Subjects
w('subjects.js', [[327, 397]]);
// Strategy
w('strategy.js', [[401, 522]]);
// Quiz engine
w('quiz-engine.js', [[524, 580]]);
// Report
w('quiz-report.js', [[582, 602]]);
// History
w('history.js', [[604, 610]]);
// Dashboard
w('dashboard.js', [[612, 684]]);
// Exam
w('exam.js', [[686, 842]]);
// Backup
w('backup.js', [[844, 860]]);
// Achievements
w('achievements.js', [[862, 886]]);
// Settings
w('settings.js', [[887, 902]]);
// AI workflow
w('ai-workflow.js', [[904, 908], [1111, 1559]]);
// Notices
w('notices.js', [[910, 969], [971, 1110]]);
// SRS
w('srs.js', [[1560, 1694]]);
// Users (auth UI + user center + account + admin)
w('users.js', [[1697, 1861], [1863, 1925], [1928, 2331]]);
// App (showScreen + mobile sidebar + DOMContentLoaded)
w('app.js', [[1694, 1695], [2333, 2347]]);

// Replace script tag in HTML
const scriptOrder = [
  'config.js','utils.js','db.js','api.js','state.js',
  'subjects.js','strategy.js','quiz-engine.js','quiz-report.js',
  'history.js','dashboard.js','exam.js','backup.js',
  'achievements.js','settings.js','ai-workflow.js','notices.js',
  'srs.js','users.js','app.js'
];
const tags = scriptOrder.map(s => '  <script src="js/' + s + '"></script>').join('\n');
const newHtml = html.replace(/<script>[\s\S]*?<\/script>/, tags + '\n');
fs.writeFileSync('D:/Qbao/index.html', newHtml, 'utf-8');
console.log('\nDone! index.html updated with ' + scriptOrder.length + ' script tags');
